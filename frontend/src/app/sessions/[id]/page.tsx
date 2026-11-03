import SessionDetailPage from './client';
import { STATIC_PARAM_PLACEHOLDER } from '@/lib/static-param';

// Needed for `output: 'export'`: prerender a single placeholder page that the
// Cloudflare Worker serves for every session id. No effect on standalone builds.
export function generateStaticParams() {
  return [{ id: STATIC_PARAM_PLACEHOLDER }];
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SessionDetailPage params={params} />;
}
