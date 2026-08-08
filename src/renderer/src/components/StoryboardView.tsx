export function StoryboardView(): React.JSX.Element {
  return (
    <div className="storyboard">
      <div className="grid">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div key={n} className="ghost-panel">
            panel {String(n).padStart(2, '0')}
          </div>
        ))}
      </div>
      <p className="note">
        Storyboard lands in Phase 6 — cheap prompt-and-sketch panels for planning shots before
        spending a real generation. Promoting a panel turns it into a real node on the Canvas.
      </p>
    </div>
  )
}
