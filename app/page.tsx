import dynamic from 'next/dynamic';

const CarpApp = dynamic(() => import('@/components/CarpApp'), { ssr: false });

export default function Page() {
  return <CarpApp />;
}
