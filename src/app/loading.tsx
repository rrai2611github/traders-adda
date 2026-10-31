/** Shown while a page is on its way: the logo mark and a soft shimmer, not a blank screen. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-4">
      <span className="flex h-12 w-12 rotate-[-12deg] items-center justify-center rounded-2xl bg-[#f0c14b] text-xl font-black text-[#0b1a34] shadow-[0_8px_24px_rgba(240,193,75,0.35)]">╱</span>
      <span className="text-[15px] font-extrabold tracking-[-0.02em] text-slate-900">Traders <span className="text-accent">Adda</span></span>
      <span className="skeleton-line w-40" />
    </div>
  );
}
