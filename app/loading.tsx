export default function Loading() {
  return (
    <main className="screen loadingScreen" aria-label="Loading patch tracker">
      <section className="actions" aria-hidden="true">
        <div className="loadingAction loadingWide" />
        <div className="loadingAction" />
        <div className="loadingAction" />
        <div className="loadingAction" />
      </section>

      <section className="calendarPanel loadingPanel" aria-hidden="true">
        <div className="loadingMonthBar">
          <div className="loadingIcon" />
          <div className="loadingTitle" />
          <div className="loadingIcon" />
        </div>
        <div className="loadingCalendarGrid">
          {Array.from({ length: 42 }, (_, index) => (
            <div className="loadingDay" key={index} />
          ))}
        </div>
      </section>

      <section className="statsPanel loadingPanel" aria-hidden="true">
        <div className="loadingStatsTitle" />
        <div className="statsGrid">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="loadingStat" key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
