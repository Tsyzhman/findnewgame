import { DailyHub } from '@/components/daily-hub';
export const metadata = { title: 'Your Daily Three' };
export default function TodayPage() {
  return (
    <main className="container product-page">
      <DailyHub />
    </main>
  );
}
