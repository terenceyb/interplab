/* eslint-disable @typescript-eslint/no-explicit-any -- JSZip 与 DOM 解析返回的对象结构由运行时决定 */
/**
 * PPTX → 「可渲染场景」解析器
 *
 * 训练时要看到的是**原版式**（母版背景、图片位置、字号颜色、表格），
 * 而不是从 pptx 里抽出来的一串文字。这里把 DrawingML 的几何/填充/文字
 * 翻译成一组绝对定位的盒子，交给 React 渲染成 DOM（可选中文字、可缩放）。
 *
 * 覆盖范围：
 *  - 幻灯片尺寸 p:sldSz、母版背景 p:bg（纯色 / 图片）
 *  - 形状 p:sp：位置、旋转、圆角/椭圆、纯色与渐变填充、描边
 *  - 占位符继承：形状自身没有 a:xfrm 时，按 layout 里同 ph 占位符的几何定位
 *  - 图片 p:pic（含裁剪框）、表格 p:graphicFrame/a:tbl、组合 p:grpSp（递归 + 子坐标系变换）
 *  - 文字：段落对齐、项目符号、行距、粗斜体/下划线/字号/颜色
 *
 * 不做：动画、嵌入视频、图表数据、艺术字效果——这些在训练场景里也不影响看稿。
 */

import { decodeXmlBytes, putSlideImage } from '@/lib/document';

export interface SceneRun {
  t: string;
  br?: boolean;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** 百分之一磅 */
  sz?: number;
  color?: string;
}

export interface ScenePara {
  runs: SceneRun[];
  align?: 'left' | 'center' | 'right' | 'justify';
  bullet?: string;
  /** 缩进（EMU），转换成 cqw 在渲染层处理 */
  indent?: number;
  /** 行距倍数 */
  lineHeight?: number;
  /** 段后距（EMU） */
  spaceAfter?: number;
  /** 大纲级别 0-8（a:pPr/@lvl），用于继承母版的项目符号与字号 */
  lvl?: number;
}

export interface SceneShape {
  kind: 'box' | 'image' | 'table';
  /** 归一化坐标 0~1（相对幻灯片宽/高） */
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  fill?: string;
  stroke?: { color: string; w: number };
  radius?: number;
  ellipse?: boolean;
  text?: ScenePara[];
  anchor?: 'top' | 'middle' | 'bottom';
  inset?: [number, number, number, number];
  /** 图片的 IndexedDB 引用（img:xxx） */
  img?: string;
  table?: { rows: string[][]; cols: number[]; header?: boolean };
}

export interface SceneSlide {
  bg?: string;
  bgImg?: string;
  shapes: SceneShape[];
}

export interface Scene {
  /** 归一化后的宽高比用宽/高表示 */
  ratio: number;
  /** 幻灯片宽度（磅），用于把字号换算成 cqw */
  widthPt: number;
  slides: SceneSlide[];
}

/* ------------------------------------------------------------------ */
/* DOM 小工具                                                          */
/* ------------------------------------------------------------------ */

const kids = (el: Element | null | undefined, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string): Element | null => kids(el, name)[0] ?? null;
const deep = (el: Element | null | undefined, name: string): Element[] =>
  el ? Array.from(el.getElementsByTagName('*')).filter((c) => c.localName === name) : [];
const num = (el: Element | null | undefined, attr: string, dflt = 0): number => {
  const v = el?.getAttribute(attr);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : dflt;
};
const relId = (el: Element | null | undefined, name: string): string => {
  if (!el) return '';
  return (
    el.getAttribute(`r:${name}`) ||
    el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name) ||
    ''
  );
};

const PRESET_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#00B050',
  blue: '#0070C0',
  yellow: '#FFFF00',
  gray: '#808080',
  grey: '#808080',
};

/** 取颜色节点（a:srgbClr / a:schemeClr / a:sysClr / a:prstClr） */
function colorOf(holder: Element | null, theme: Record<string, string>): string | undefined {
  if (!holder) return undefined;
  const c = Array.from(holder.children).find((e) =>
    ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(e.localName),
  );
  if (!c) return undefined;
  let base: string | undefined;
  if (c.localName === 'srgbClr') base = `#${(c.getAttribute('val') || '').toUpperCase()}`;
  else if (c.localName === 'schemeClr') base = theme[c.getAttribute('val') || ''] ?? undefined;
  else if (c.localName === 'sysClr') {
    const last = c.getAttribute('lastClr');
    base = last ? `#${last.toUpperCase()}` : '#000000';
  } else if (c.localName === 'prstClr') base = PRESET_COLORS[c.getAttribute('val') || ''] ?? '#000000';
  else if (c.localName === 'scrgbClr') base = '#000000';
  if (!base) return undefined;
  const alpha = kid(c, 'alpha')?.getAttribute('val');
  if (alpha) {
    const a = Math.max(0, Math.min(100000, Number(alpha))) / 100000;
    if (a < 0.999 && /^#[0-9a-f]{6}$/i.test(base)) {
      const r = parseInt(base.slice(1, 3), 16);
      const g = parseInt(base.slice(3, 5), 16);
      const b = parseInt(base.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }
  }
  return base;
}

/** 填充：纯色 / 渐变；返回 undefined 表示无填充 */
function fillOf(spPr: Element | null, theme: Record<string, string>): string | undefined {
  if (!spPr) return undefined;
  const solid = kid(spPr, 'solidFill');
  if (solid) return colorOf(solid, theme) ?? '#FFFFFF';
  const grad = kid(spPr, 'gradFill');
  if (grad) {
    const stops = deep(kid(grad, 'gsLst'), 'gs').map((gs) => ({
      pos: num(gs, 'pos') / 1000,
      color: colorOf(gs, theme) ?? '#FFFFFF',
    }));
    if (stops.length >= 2) {
      const ang = num(kid(grad, 'lin'), 'ang', 5400000) / 60000;
      return `linear-gradient(${ang + 90}deg, ${stops
        .sort((a, b) => a.pos - b.pos)
        .map((s) => `${s.color} ${s.pos}%`)
        .join(', ')})`;
    }
  }
  return undefined;
}

interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
}

/** 从 <a:xfrm> 元素本身读几何 */
function xfrmOfEl(x: Element | null): Xfrm | undefined {
  if (!x) return undefined;
  const off = kid(x, 'off');
  const ext = kid(x, 'ext');
  if (!off || !ext) return undefined;
  return {
    x: num(off, 'x'),
    y: num(off, 'y'),
    w: num(ext, 'cx'),
    h: num(ext, 'cy'),
    rot: num(x, 'rot') ? num(x, 'rot') / 60000 : undefined,
  };
}

/** 从容器元素（p:spPr / p:grpSpPr）里读 a:xfrm */
function xfrmOf(el: Element | null): Xfrm | undefined {
  return xfrmOfEl(kid(el, 'xfrm'));
}

interface Affine {
  a: number;
  d: number;
  tx: number;
  ty: number;
}

const IDENTITY: Affine = { a: 1, d: 1, tx: 0, ty: 0 };

/** 文字段落 */
function parseParas(txBody: Element | null, theme: Record<string, string>): ScenePara[] {
  const out: ScenePara[] = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const runs: SceneRun[] = [];
    for (const child of Array.from(p.children)) {
      if (child.localName === 'r' || child.localName === 'fld') {
        const rPr = kid(child, 'rPr');
        const t = kid(child, 't')?.textContent ?? '';
        if (!t) continue;
        runs.push({
          t,
          b: rPr?.getAttribute('b') === '1',
          i: rPr?.getAttribute('i') === '1',
          u: !!rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none',
          sz: rPr?.getAttribute('sz') ? Number(rPr.getAttribute('sz')) : undefined,
          color: colorOf(kid(rPr, 'solidFill'), theme),
        });
      } else if (child.localName === 'br') {
        runs.push({ t: '', br: true });
      }
    }
    const buChar = kid(pPr, 'buChar')?.getAttribute('char');
    const buNone = !!kid(pPr, 'buNone');
    const lnSpc = kid(pPr, 'lnSpc');
    const pct = kid(lnSpc, 'spcPct')?.getAttribute('val');
    const spcAft = kid(pPr, 'spcAft');
    if (!runs.length) {
      if (out.length) out.push({ runs: [{ t: '', br: true }] });
      continue;
    }
    out.push({
      runs,
      lvl: pPr?.getAttribute('lvl') ? Number(pPr.getAttribute('lvl')) : 0,
      align:
        pPr?.getAttribute('algn') === 'ctr'
          ? 'center'
          : pPr?.getAttribute('algn') === 'r'
            ? 'right'
            : pPr?.getAttribute('algn') === 'just'
              ? 'justify'
              : 'left',
      bullet: buNone ? undefined : (buChar ?? (kid(pPr, 'buAutoNum') ? '•' : undefined)),
      indent: pPr?.getAttribute('marL') ? Number(pPr.getAttribute('marL')) : undefined,
      lineHeight: pct ? Number(pct) / 100000 : undefined,
      spaceAfter: spcAft ? num(kid(spcAft, 'spcPts'), 'val') * 100 : undefined,
    });
  }
  return out;
}

/** 母版 / 版式里的占位符几何 */
function placeholderMap(doc: Document | null): Map<string, Xfrm> {
  const map = new Map<string, Xfrm>();
  if (!doc) return map;
  for (const sp of deep(doc.documentElement, 'sp')) {
    const ph = deep(sp, 'ph')[0];
    if (!ph) continue;
    const xf = xfrmOf(kid(sp, 'spPr'));
    if (!xf) continue;
    const t = ph.getAttribute('type') || 'body';
    const idx = ph.getAttribute('idx') || '0';
    map.set(`${t}|${idx}`, xf);
    if (!map.has(t)) map.set(t, xf);
  }
  return map;
}

interface LevelStyle {
  bullet?: string;
  sz?: number;
}

/**
 * 母版里的正文/标题样式：项目符号字符与默认字号。
 * 幻灯片 XML 经常只写文字不写字号与 bullet（交给版式继承），
 * 不读这里就会出现「要点没有小圆点、字号全一样」的失真。
 */
function levelStyles(masterDoc: Document | null): { title: LevelStyle[]; body: LevelStyle[] } {
  const out: { title: LevelStyle[]; body: LevelStyle[] } = { title: [], body: [] };
  if (!masterDoc) return out;
  const styles = deep(masterDoc.documentElement, 'txStyles')[0];
  const grab = (host: Element | null): LevelStyle[] => {
    const list: LevelStyle[] = [];
    let prev: LevelStyle = {};
    for (let lvl = 1; lvl <= 9; lvl++) {
      const pPr = kid(host, `lvl${lvl}pPr`);
      if (!pPr) {
        list.push(prev);
        continue;
      }
      const buNone = !!kid(pPr, 'buNone');
      const buChar = kid(pPr, 'buChar')?.getAttribute('char') ?? undefined;
      const szAttr = kid(pPr, 'defRPr')?.getAttribute('sz');
      prev = {
        bullet: buNone ? undefined : (buChar ?? prev.bullet),
        sz: szAttr ? Number(szAttr) : prev.sz,
      };
      list.push(prev);
    }
    return list;
  };
  out.title = grab(kid(styles, 'titleStyle'));
  out.body = grab(kid(styles, 'bodyStyle'));
  return out;
}

/** 主题配色 */
function themeColors(doc: Document | null): Record<string, string> {
  const out: Record<string, string> = {
    tx1: '#000000',
    bg1: '#FFFFFF',
    tx2: '#44546A',
    bg2: '#E7E6E6',
    dk1: '#000000',
    lt1: '#FFFFFF',
  };
  const scheme = doc ? deep(doc.documentElement, 'clrScheme')[0] : null;
  for (const slot of Array.from(scheme?.children ?? [])) {
    const el = Array.from(slot.children)[0];
    if (!el) continue;
    const hex =
      el.localName === 'srgbClr'
        ? `#${(el.getAttribute('val') || '').toUpperCase()}`
        : el.localName === 'sysClr'
          ? `#${(el.getAttribute('lastClr') || '000000').toUpperCase()}`
          : undefined;
    if (hex) out[slot.localName] = hex;
  }
  out.bg1 = out.lt1 ?? out.bg1;
  out.tx1 = out.dk1 ?? out.tx1;
  out.bg2 = out.lt2 ?? out.bg2;
  out.tx2 = out.dk2 ?? out.tx2;
  return out;
}

/* ------------------------------------------------------------------ */
/* 主解析                                                              */
/* ------------------------------------------------------------------ */

const sceneCache = new Map<string, Scene>();

/**
 * 把 pptx 解析成可渲染场景。
 * @param key 源文件在 IndexedDB 的 key（同时作为缓存键）
 */
export async function loadScene(key: string, blob: Blob): Promise<Scene> {
  const hit = sceneCache.get(key);
  if (hit) return hit;

  const { default: JSZip } = await import('jszip');
  const zip: any = await JSZip.loadAsync(await blob.arrayBuffer());
  const parser = new DOMParser();
  const xml = async (path: string): Promise<Document | null> => {
    const f = zip.file(path);
    if (!f) return null;
    // 与文本解析共用同一套编码识别：GBK 声明的 XML 直接 toString 会变乱码
    const text = decodeXmlBytes(await f.async('uint8array'));
    try {
      return parser.parseFromString(text, 'application/xml');
    } catch {
      return null;
    }
  };

  /* 幻灯片尺寸 */
  const pres = await xml('ppt/presentation.xml');
  const szEl = pres ? deep(pres.documentElement, 'sldSz')[0] : null;
  const slideW = num(szEl, 'cx', 12192000);
  const slideH = num(szEl, 'cy', 6858000);
  const ratio = slideW / slideH;
  const widthPt = slideW / 12700;

  /* 主题色 */
  const theme = themeColors(await xml('ppt/theme/theme1.xml'));

  /* 版式/母版的占位符映射按文件缓存：一页一份版式，重复解析纯属浪费 */
  const phCache = new Map<string, Map<string, Xfrm>>();
  const styleCache = new Map<string, { title: LevelStyle[]; body: LevelStyle[] }>();
  const phOf = async (p: string): Promise<Map<string, Xfrm>> => {
    if (!p) return new Map();
    const hit = phCache.get(p);
    if (hit) return hit;
    const map = placeholderMap(await xml(p));
    phCache.set(p, map);
    return map;
  };

  /* 页序 */
  const order = await slideOrderFromZip(zip, xml);

  const slides: SceneSlide[] = [];
  for (const path of order) {
    const doc = await xml(path);
    if (!doc) continue;
    const relPath = path.replace(/slides\/([^/]+)$/, 'slides/_rels/$1.rels');
    const relDoc = await xml(relPath);
    const rels = new Map<string, string>();
    for (const rel of Array.from(relDoc?.documentElement.children ?? [])) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) rels.set(id, target);
    }

    /* 占位符几何继承：幻灯片 → 版式 → 母版，逐级往上找 */
    const layoutRel = relDoc
      ? Array.from(relDoc.documentElement.children).find(
          (r) => /slideLayout$/.test(r.getAttribute('Type') || ''),
        )
      : undefined;
    const layoutPath = layoutRel ? normPath(path, layoutRel.getAttribute('Target') || '') : '';
    const layoutPh = await phOf(layoutPath);
    let masterPh = new Map<string, Xfrm>();
    let masterStyles = { title: [] as LevelStyle[], body: [] as LevelStyle[] };
    if (layoutPath) {
      const lrPath = layoutPath.replace(/slideLayouts\/([^/]+)$/, 'slideLayouts/_rels/$1.rels');
      const lr = await xml(lrPath);
      const masterRel = lr
        ? Array.from(lr.documentElement.children).find((r) => /slideMaster$/.test(r.getAttribute('Type') || ''))
        : undefined;
      if (masterRel) {
        const masterPath = normPath(layoutPath, masterRel.getAttribute('Target') || '');
        masterPh = await phOf(masterPath);
        if (!styleCache.has(masterPath)) styleCache.set(masterPath, levelStyles(await xml(masterPath)));
        masterStyles = styleCache.get(masterPath)!;
      }
    }

    const slide: SceneSlide = { shapes: [] };
    const cSld = deep(doc.documentElement, 'cSld')[0];
    const bg = kid(cSld, 'bg');
    if (bg) {
      const bgPr = kid(bg, 'bgPr');
      const color = fillOf(bgPr, theme);
      if (color) slide.bg = color;
      const bgImgRel = relId(kid(kid(bgPr, 'blipFill'), 'blip'), 'embed');
      if (bgImgRel) slide.bgImg = await imageKey(zip, rels, bgImgRel, path);
    }

    const spTree = deep(doc.documentElement, 'spTree')[0];
    if (spTree) {
      await walk(spTree, IDENTITY, {
        zip,
        rels,
        path,
        theme,
        layoutPh,
        masterPh,
        styles: masterStyles,
        slideW,
        slideH,
        out: slide.shapes,
        imgCache: new Map(),
      });
    }
    slides.push(slide);
  }

  const scene: Scene = { ratio, widthPt, slides };
  // 只缓存几何与引用，体积很小；最多留 3 份文件
  if (sceneCache.size >= 3) sceneCache.clear();
  sceneCache.set(key, scene);
  return scene;
}

export function clearSceneCache() {
  sceneCache.clear();
}

interface Ctx {
  zip: any;
  rels: Map<string, string>;
  path: string;
  theme: Record<string, string>;
  layoutPh: Map<string, Xfrm>;
  masterPh: Map<string, Xfrm>;
  styles: { title: LevelStyle[]; body: LevelStyle[] };
  slideW: number;
  slideH: number;
  out: SceneShape[];
  imgCache: Map<string, string>;
}

async function imageKey(zip: any, rels: Map<string, string>, id: string, base: string): Promise<string | undefined> {
  const target = rels.get(id);
  if (!target) return '';
  const path = normPath(base, target);
  const f = zip.file(path);
  if (!f) return '';
  const raw: Blob = await f.async('blob');
  const ext = (path.split('.').pop() || 'png').toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'webp'
            ? 'image/webp'
            : 'image/png';
  return putSlideImage(new Blob([raw], { type: mime }));
}

function normPath(base: string, target: string): string {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1).concat(target.split('/'));
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

async function walk(container: Element, tf: Affine, ctx: Ctx): Promise<void> {
  for (const node of Array.from(container.children)) {
    if (node.localName === 'sp') await shape(node, tf, ctx);
    else if (node.localName === 'pic') await picture(node, tf, ctx);
    else if (node.localName === 'graphicFrame') await table(node, tf, ctx);
    else if (node.localName === 'grpSp') await group(node, tf, ctx);
  }
}

/** 子坐标系 → 父坐标系 */
function groupTf(grpSp: Element, tf: Affine): { tf: Affine } {
  const x = kid(grpSp, 'grpSpPr');
  const xf = kid(x, 'xfrm');
  if (!xf) return { tf };
  const off = kid(xf, 'off');
  const ext = kid(xf, 'ext');
  const chOff = kid(xf, 'chOff');
  const chExt = kid(xf, 'chExt');
  if (!off || !ext || !chOff || !chExt) return { tf };
  const ex = num(ext, 'cx') || 1;
  const ey = num(ext, 'cy') || 1;
  const cx = num(chExt, 'cx') || ex;
  const cy = num(chExt, 'cy') || ey;
  const sx = ex / cx;
  const sy = ey / cy;
  return {
    tf: {
      a: tf.a * sx,
      d: tf.d * sy,
      tx: tf.tx + tf.a * (num(off, 'x') - num(chOff, 'x') * sx),
      ty: tf.ty + tf.d * (num(off, 'y') - num(chOff, 'y') * sy),
    },
  };
}

async function group(node: Element, tf: Affine, ctx: Ctx) {
  const g = groupTf(node, tf);
  await walk(node, g.tf, ctx);
}

function place(xf: Xfrm, tf: Affine, ctx: Ctx): Pick<SceneShape, 'x' | 'y' | 'w' | 'h' | 'rot'> {
  return {
    x: (tf.a * xf.x + tf.tx) / ctx.slideW,
    y: (tf.d * xf.y + tf.ty) / ctx.slideH,
    w: (tf.a * xf.w) / ctx.slideW,
    h: (tf.d * xf.h) / ctx.slideH,
    rot: xf.rot,
  };
}

async function shape(node: Element, tf: Affine, ctx: Ctx) {
  const spPr = kid(node, 'spPr');
  const ph = deep(kid(node, 'nvSpPr'), 'ph')[0];
  const type = ph?.getAttribute('type') || 'body';
  let xf = xfrmOf(spPr);
  if (!xf && ph) {
    const idx = ph.getAttribute('idx') || '0';
    for (const map of [ctx.layoutPh, ctx.masterPh]) {
      xf = map.get(`${type}|${idx}`) ?? map.get(type);
      if (xf) break;
    }
  }
  if (!xf) return;

  const prst = kid(kid(spPr, 'prstGeom'), 'prst')?.getAttribute('prst') || '';
  const fill = fillOf(spPr, ctx.theme);
  const ln = kid(spPr, 'ln');
  const strokeColor = colorOf(kid(ln, 'solidFill'), ctx.theme);
  const text = parseParas(kid(node, 'txBody'), ctx.theme);
  const bodyPr = kid(kid(node, 'txBody'), 'bodyPr');
  const anchorAttr = bodyPr?.getAttribute('anchor');

  // 占位符才继承母版的项目符号与字号；普通文本框保持原样
  if (ph && text.length) {
    const style = type === 'title' || type === 'ctrTitle' ? ctx.styles.title : ctx.styles.body;
    for (const para of text) {
      const st = style[Math.min(8, Math.max(0, para.lvl ?? 0))];
      if (!st) continue;
      if (!para.bullet && st.bullet) para.bullet = st.bullet;
      if (st.sz) for (const run of para.runs) if (!run.sz) run.sz = st.sz;
    }
  }

  const sh: SceneShape = {
    kind: 'box',
    ...place(xf, tf, ctx),
    fill,
    stroke: strokeColor ? { color: strokeColor, w: num(ln, 'w', 9525) / 12700 } : undefined,
    ellipse: prst === 'ellipse' || prst === 'circle',
    radius: prst === 'roundRect' ? 0.08 : undefined,
    text: text.length ? text : undefined,
    anchor: anchorAttr === 'ctr' ? 'middle' : anchorAttr === 'b' ? 'bottom' : 'top',
    inset: [
      num(bodyPr, 'lIns', 91440),
      num(bodyPr, 'tIns', 45720),
      num(bodyPr, 'rIns', 91440),
      num(bodyPr, 'bIns', 45720),
    ],
  };
  if (!sh.fill && !sh.stroke && !sh.text) return;
  ctx.out.push(sh);
}

async function picture(node: Element, tf: Affine, ctx: Ctx) {
  const spPr = kid(node, 'spPr');
  const xf = xfrmOf(spPr);
  if (!xf) return;
  const blip = kid(kid(node, 'blipFill'), 'blip');
  const embed = relId(blip, 'embed');
  if (!embed) return;
  let key = ctx.imgCache.get(embed);
  if (key === undefined) {
    key = (await imageKey(ctx.zip, ctx.rels, embed, ctx.path)) || '';
    ctx.imgCache.set(embed, key);
  }
  if (!key) return;
  ctx.out.push({ kind: 'image', ...place(xf, tf, ctx), img: key });
}

async function table(node: Element, tf: Affine, ctx: Ctx) {
  // 表格的几何直接挂在 p:xfrm 上，不再套一层 p:spPr
  const xf = xfrmOfEl(kid(node, 'xfrm'));
  if (!xf) return;
  const tbl = deep(node, 'tbl')[0];
  if (!tbl) return;
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(c, 'w'));
  const rows: string[][] = [];
  kids(tbl, 'tr').forEach((tr) => {
    rows.push(
      kids(tr, 'tc').map((tc) =>
        deep(kid(tc, 'txBody'), 'p')
          .map((p) => deep(p, 't').map((t) => t.textContent || '').join(''))
          .join('\n')
          .trim(),
      ),
    );
  });
  if (!rows.length) return;
  ctx.out.push({ kind: 'table', ...place(xf, tf, ctx), table: { rows, cols } });
}

/** 与 document.ts 的页序逻辑一致：先看 sldIdLst，再退化到文件名排序 */
async function slideOrderFromZip(
  zip: any,
  xml: (p: string) => Promise<Document | null>,
): Promise<string[]> {
  const pres = await xml('ppt/presentation.xml');
  const relDoc = await xml('ppt/_rels/presentation.xml.rels');
  if (pres && relDoc) {
    const rels = new Map<string, string>();
    for (const rel of Array.from(relDoc.documentElement.children)) {
      const id = rel.getAttribute('Id');
      const t = rel.getAttribute('Target');
      if (id && t) rels.set(id, t);
    }
    const order: string[] = [];
    for (const sld of deep(pres.documentElement, 'sldId')) {
      const rid = sld.getAttribute('r:id') || sld.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      );
      const t = rid ? rels.get(rid) : '';
      if (!t) continue;
      const path = normPath('ppt/presentation.xml', t);
      if (zip.file(path)) order.push(path);
    }
    if (order.length) return order;
  }
  return Object.keys(zip.files)
    .filter((p: string) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a: string, b: string) => {
      const n = (s: string) => Number(s.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return n(a) - n(b);
    });
}
