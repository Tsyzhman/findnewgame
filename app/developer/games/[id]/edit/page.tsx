import { GameEditor } from '@/components/game-editor';
export const metadata = {
  title: 'Revise game materials',
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GameEditor gameId={id} />;
}
