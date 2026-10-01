import {Platform} from 'react-native';
import {api} from './api';
function safeName(name:string){return name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,150)||'document';}
export async function downloadPrivateFile(mediaId:string,name:string,mime:string,saveGallery=false){
 const access=await api<{url:string}>(`/v1/media/${mediaId}/access`,{method:'POST'});
 if(Platform.OS==='web'){const a=document.createElement('a');a.href=access.url;a.download=safeName(name);a.target='_blank';a.rel='noopener';a.click();return;}
 const fs=await import('expo-file-system/legacy'),path=`${fs.cacheDirectory}${mediaId}-${safeName(name)}`;
 const result=await fs.downloadAsync(access.url,path);if(result.status!==200)throw new Error('This file could not be downloaded. Try again.');
 if(saveGallery){const gallery=await import('expo-media-library');const permission=await gallery.requestPermissionsAsync(true);if(!permission.granted)throw new Error('Allow photo access to save this file.');await gallery.saveToLibraryAsync(result.uri);}
 else{const sharing=await import('expo-sharing');if(!await sharing.isAvailableAsync())throw new Error('No document viewer is available on this phone.');await sharing.shareAsync(result.uri,{mimeType:mime,dialogTitle:'Open or save document'});}
}
