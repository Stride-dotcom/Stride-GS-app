import { useState, useEffect } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [isTablet, setIsTablet] = useState(() => window.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches);
  const [isExtraSmall, setIsExtraSmall] = useState(() => window.matchMedia('(max-width: 479px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const mqTab = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
    const mqXs = window.matchMedia('(max-width: 479px)');
    const handler = () => setIsMobile(mq.matches);
    const handlerTab = () => setIsTablet(mqTab.matches);
    const handlerXs = () => setIsExtraSmall(mqXs.matches);
    mq.addEventListener('change', handler);
    mqTab.addEventListener('change', handlerTab);
    mqXs.addEventListener('change', handlerXs);
    return () => {
      mq.removeEventListener('change', handler);
      mqTab.removeEventListener('change', handlerTab);
      mqXs.removeEventListener('change', handlerXs);
    };
  }, []);

  return { isMobile, isTablet, isExtraSmall };
}
