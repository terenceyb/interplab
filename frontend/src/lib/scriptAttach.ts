import type { Material } from '@/types';
import type { ParsedDoc } from '@/lib/document';
import { getVA } from '@/lib/hooks';
import { alignScript } from '@/lib/text';
import { clipActivity, estimateRate } from '@/lib/vad';

/**
 * 把解析好的稿件挂到素材上：对齐到音频、估算难度、保留块结构。
 * 上传入口分散在素材页和训练页，统一走这里，避免两处逻辑分叉。
 */
export async function buildScriptPatch(
  material: Material,
  doc: ParsedDoc,
  fileName?: string,
): Promise<Partial<Material>> {
  const effDur = Math.max(0, material.trim.end - material.trim.start);
  const va = await getVA(material).catch(() => undefined);
  const clipped = va ? clipActivity(va, material.trim.start, material.trim.end) : undefined;
  const blocks = doc.blocks?.length ? doc.blocks : undefined;
  const sentences = alignScript(doc.text, effDur, clipped, material.trim.start, blocks);
  const rate = estimateRate(sentences.map((s) => s.text).join(' '), effDur);
  const avgLen = sentences.length ? sentences.reduce((a, b) => a + b.text.length, 0) / sentences.length : 0;
  const density: 1 | 2 | 3 = avgLen > 45 ? 3 : avgLen > 22 ? 2 : 1;

  return {
    script: doc.text,
    blocks,
    scriptFile: fileName || material.scriptFile,
    scriptEncoding: doc.encoding,
    sentences,
    wpm: rate.wpm,
    density,
    docKind: material.slides?.length ? 'slides' : 'text',
  };
}
