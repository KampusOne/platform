import {notFound,redirect} from 'next/navigation';
import {validSharedPath} from '@/lib/app-link-association';
export const metadata={title:'Open in KampusOne',description:'Open this content in KampusOne, or download the app.'};
export default async function SharedPage({params}:{params:Promise<{kind:string;id:string}>}){
 const {kind,id}=await params;
 if(!validSharedPath(kind,id))notFound();
 // Verified Android/iOS links are intercepted by the OS before this browser
 // fallback. A browser visit goes to the original download landing page.
 redirect('https://www.kampusone.app/?open='+encodeURIComponent('s/'+kind+'/'+id));
}
