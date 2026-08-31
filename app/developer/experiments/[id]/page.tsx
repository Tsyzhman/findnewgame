import { ExperimentReport } from '@/components/developer-reports';
export const metadata = {
  title: 'Experiment comparison',
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ExperimentReport experimentId={(await params).id} />;
}
