import { TasteCalibration } from '@/components/taste-calibration';
export const metadata = { title: 'Your preferences' };
export default function SettingsPage() {
  return (
    <main className="container product-page">
      <TasteCalibration settings />
    </main>
  );
}
