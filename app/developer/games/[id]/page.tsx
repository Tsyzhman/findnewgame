import { CalibrationPage } from '@/components/developer-reports';
export const metadata = {
  title: 'Calibration report',
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CalibrationPage gameId={(await params).id} />;
}
