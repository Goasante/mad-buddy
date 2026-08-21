export default function LinkrLoading() {
  return (
    <div className="linkr-safe-screen" data-linkr-safe-area>
      <section className="linkr-return-loading" role="status" aria-live="polite">
        <span className="linkr-return-loading__pulse" aria-hidden />
        <strong>Refreshing your Linkr…</strong>
        <small>Checking your profile and who is available now.</small>
      </section>
    </div>
  );
}
