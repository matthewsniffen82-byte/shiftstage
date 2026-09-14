import { createPerformanceReceiver } from '@/src/lib/performance-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createPerformanceReceiver(report => console.info(JSON.stringify(report)));
