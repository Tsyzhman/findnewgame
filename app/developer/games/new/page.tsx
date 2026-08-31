import { GameEditor } from '@/components/game-editor';
export const metadata = {
  title: 'Submit your game',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <GameEditor />;
}
