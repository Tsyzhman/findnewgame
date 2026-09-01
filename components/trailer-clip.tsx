export function TrailerClip({ youtubeId }: { youtubeId: string }) {
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&controls=1&rel=0&playsinline=1&hl=en&cc_lang_pref=en&cc_load_policy=1`;
  return (
    <div className="trailer-clip">
      <iframe
        src={src}
        title="Mystery game trailer or teaser"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
