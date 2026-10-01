import {Suspense} from 'react';
import {AccessGate} from '@/components/access-gate';
import {TrustedVendorApplication} from '@/components/trusted-vendor-application';
export default function ExclusiveVendorPage(){return <AccessGate surface="agents"><Suspense fallback={<p>Checking your invitation…</p>}><TrustedVendorApplication/></Suspense></AccessGate>;}
