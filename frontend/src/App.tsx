import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/store/useApp';
import Dashboard from '@/pages/Dashboard';
import Library from '@/pages/Library';
import MaterialDetail from '@/pages/MaterialDetail';
import Consecutive from '@/pages/Consecutive';
import SimText from '@/pages/SimText';
import SimNoScript from '@/pages/SimNoScript';
import Shadowing from '@/pages/Shadowing';
import Review from '@/pages/Review';
import Growth from '@/pages/Growth';
import Glossary from '@/pages/Glossary';
import ExportPage from '@/pages/ExportPage';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';

export default function App() {
  const init = useApp((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);

  return (
    <HashRouter>
      <TooltipProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/library" element={<Library />} />
            <Route path="/material/:id" element={<MaterialDetail />} />
            <Route path="/train/consecutive/:materialId" element={<Consecutive />} />
            <Route path="/train/sim-text/:materialId" element={<SimText />} />
            <Route path="/train/sim-noscript/:materialId" element={<SimNoScript />} />
            <Route path="/train/shadowing/:materialId" element={<Shadowing />} />
            <Route path="/review" element={<Review />} />
            <Route path="/review/:id" element={<Review />} />
            <Route path="/growth" element={<Growth />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppShell>
        <Toaster />
      </TooltipProvider>
    </HashRouter>
  );
}
