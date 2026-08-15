import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className="h-6 w-6 shrink-0"
      {...props}
    />
  );
}

export function SignalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4.9 16.1a10 10 0 0 1 14.2 0M7.8 13.2a6 6 0 0 1 8.4 0M12 18.5v.01" />
    </Icon>
  );
}

export function ActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2.5 7L14 4l2 8h5" />
    </Icon>
  );
}

export function ShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 2 3 6v6c0 5 4 8.5 9 10 5-1.5 9-5 9-10V6l-9-4Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}
