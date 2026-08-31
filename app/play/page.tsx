import { Suspense } from 'react';
import { GamePlayer } from '@/components/game-player';
import { Loading } from '@/components/product-ui';
export const metadata = {
  title: 'Play your Daily Three',
  robots: { index: false, follow: false },
};
export default function PlayPage() {
  return (
    <main className="container product-page game-page">
      <Suspense fallback={<Loading />}>
        <GamePlayer />
      </Suspense>
    </main>
  );
}
