'use client';
import Link from 'next/link';
import {
  ArrowRight,
  CircleAlert,
  Compass,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiFailure, errorMessage, signInPath } from '@/lib/api';

export function ActionButton({
  children,
  busy = false,
  secondary = false,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'className'> & {
  className?: string;
  busy?: boolean;
  secondary?: boolean;
}) {
  return (
    <Button
      {...props}
      disabled={props.disabled || busy}
      className={`fng-button ${secondary ? 'button-secondary' : 'button-primary'} ${props.className ?? ''}`}
    >
      {busy ? <LoaderCircle className="spin" size={17} /> : null}
      {children}
    </Button>
  );
}
export function Loading({
  label = 'Finding your next discovery…',
}: {
  label?: string;
}) {
  return (
    <output className="loading-state">
      <LoaderCircle className="spin" size={28} />
      <p>{label}</p>
    </output>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const isSignIn = error instanceof ApiFailure && error.status === 401;
  const onboarding =
    error instanceof ApiFailure && error.code === 'onboarding_required';
  return (
    <div className="notice error-notice" role="alert">
      <CircleAlert size={20} />
      <div>
        <p>{errorMessage(error)}</p>
        {retry && (
          <button className="text-link" onClick={retry}>
            Try again <ArrowRight size={15} />
          </button>
        )}
        {isSignIn && (
          <a className="text-link" href={signInPath()} target="_top">
            Sign in to continue <ArrowRight size={15} />
          </a>
        )}
        {onboarding && (
          <Link prefetch={false} className="text-link" href="/onboarding">
            Calibrate your taste <ArrowRight size={15} />
          </Link>
        )}
      </div>
    </div>
  );
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'success' | 'warning';
}) {
  return (
    <div className={`notice ${tone}`}>
      <ShieldCheck size={18} />
      <div>{children}</div>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Field({
  label,
  help,
  children,
  id,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <p className="field-help">{help}</p>}
    </div>
  );
}
export function TextInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className={`fng-input ${props.className ?? ''}`} />;
}
export function AuthGate({
  returnTo = '/onboarding',
  developer = false,
}: {
  returnTo?: string;
  developer?: boolean;
}) {
  return (
    <div className="auth-card surface">
      <div className="auth-icon">
        <Compass size={32} />
      </div>
      <p className="eyebrow">YOUR NEXT DISCOVERY STARTS HERE</p>
      <h1>
        {developer
          ? 'Fresh eyes for your game.'
          : 'Make this daily ritual yours.'}
      </h1>
      <p>
        {developer
          ? 'Submit your game for free, learn what your store assets communicate, and compare new ideas.'
          : 'Sign in to build your taste profile, get three personal discoveries a day, and keep your finds.'}
      </p>
      <a className="button-primary" href={signInPath(returnTo)} target="_top">
        Continue with ChatGPT <ArrowRight size={18} />
      </a>
      <p className="field-help">
        A free FindNewGame profile is created on first sign-in. Your email is
        never shared with game developers.
      </p>
      <Link prefetch={false} href="/play?demo=1" className="text-link">
        Just looking? Play the demo
      </Link>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state surface">
      <Compass size={32} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending_review: 'In review',
    published: 'Published',
    active: 'Active',
    approved: 'Approved',
    rejected: 'Rejected',
    changes_requested: 'Changes requested',
    completed: 'Completed',
    awaiting_payment: 'Awaiting payment',
    unpaid: 'Unpaid',
    paid: 'Paid',
    paused: 'Paused',
    creating: 'Creating invoice',
    uncertain: 'Needs reconciliation',
    refunded: 'Refunded',
    failed: 'Failed',
    pending: 'Pending',
    withdrawn: 'Withdrawn',
  };
  return (
    <span
      className={`status-badge ${['published', 'active', 'approved', 'paid', 'completed'].includes(status) ? 'success' : status === 'rejected' || status === 'failed' ? 'danger' : 'muted'}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
