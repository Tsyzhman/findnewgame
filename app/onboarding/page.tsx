import { TasteCalibration } from '@/components/taste-calibration';
export const metadata = { title: 'Taste calibration' };
export default function OnboardingPage() {
  return (
    <main className="container product-page">
      <TasteCalibration />
    </main>
  );
}
