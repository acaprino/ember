export function Banner({ title }: { title: string }) {
  return (
    <div className="gsd-banner">
      <div className="gsd-banner-bar" />
      <div className="gsd-banner-title">FIGTREE ► {title}</div>
      <div className="gsd-banner-bar" />
    </div>
  );
}

export function Box({ children }: { children: React.ReactNode }) {
  return <div className="gsd-box"><pre>{children}</pre></div>;
}

export function Sep() {
  return <div className="gsd-sep" />;
}
