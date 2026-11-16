export default function SubrouteTabLabel({ children, active }) {
  return (
    <span className="grid whitespace-nowrap">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-bold">
        {children}
      </span>
      <span
        className={active
          ? 'col-start-1 row-start-1 font-bold text-primary'
          : 'col-start-1 row-start-1 font-medium text-muted-foreground group-hover:text-foreground'}
      >
        {children}
      </span>
    </span>
  );
}
