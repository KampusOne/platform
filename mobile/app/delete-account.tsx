import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ToolPage, ToolButton } from '@/src/components/toolkit';
import { useAppearance } from '@/src/lib/appearance';
import { useAuth } from '@/src/auth/auth-context';
import { api } from '@/src/lib/api';

export default function DeleteAccount() {
  const {theme}=useAppearance(),{user,finishAccountDeletion}=useAuth();
  const [challenge,setChallenge]=useState(''),[code,setCode]=useState(''),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function requestCode(){
    if(busy)return;setBusy(true);setError('');
    try {const result=await api<{challengeId:string}>('/v1/account/deletion/code',{method:'POST'});setChallenge(result.challengeId);setCode('');}
    catch(e){setError(e instanceof Error?e.message:'Could not send your code. Please try again.');}finally{setBusy(false);}
  }
  async function remove(){
    if(busy)return;setBusy(true);setError('');
    try {
      const result=await api<{status:string}>('/v1/account/deletion/confirm',{method:'POST',body:JSON.stringify({challengeId:challenge,code,confirmation})});
      if(result.status!=='deleted')throw new Error('Deletion could not be confirmed. Please try again.');
      await finishAccountDeletion();router.replace('/(auth)/sign-in');
    } catch(e){setError(e instanceof Error?e.message:'Could not delete your account. Your input is still here.');}finally{setBusy(false);}
  }
  const inputStyle={fontFamily:theme.font.body,color:theme.text,borderColor:theme.border,borderWidth:1,borderRadius:12,padding:16,minHeight:52};
  return <ToolPage title="Delete account">
    <Text style={{fontFamily:theme.font.display,color:theme.text,fontSize:24,marginBottom:12}}>Leave KampusOne</Text>
    <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:23,marginBottom:16}}>This permanently removes your profile, posts, comments, study history and uploaded files. You will be signed out on every device. This cannot be undone.</Text>
    <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:22,marginBottom:20}}>Payment, order and safety records may be retained for accounting or unresolved disputes. They will no longer appear as an active profile.</Text>
    {error?<Text accessibilityRole="alert" style={{color:theme.error,marginBottom:16}}>{error}</Text>:null}
    {!challenge?<ToolButton label={busy?'Sending code…':'Send confirmation code'} disabled={busy} onPress={()=>void requestCode()}/>:<View style={{gap:16}}>
      <Text style={{color:theme.text}}>Enter the 6-digit code sent to {user?.email}. It expires in 10 minutes.</Text>
      <TextInput accessibilityLabel="Deletion confirmation code" placeholder="6-digit code" placeholderTextColor={theme.textMuted} value={code} onChangeText={value=>setCode(value.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" textContentType="oneTimeCode" style={inputStyle} editable={!busy}/>
      <TextInput accessibilityLabel="Type DELETE to confirm" placeholder="Type DELETE" placeholderTextColor={theme.textMuted} value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} style={inputStyle} editable={!busy}/>
      <ToolButton label={busy?'Deleting account…':'Permanently delete my account'} disabled={busy||code.length!==6||confirmation!=='DELETE'} onPress={()=>void remove()}/>
      <ToolButton secondary label="Send a new code" disabled={busy} onPress={()=>void requestCode()}/>
    </View>}
    <ToolButton secondary label="Keep my account" disabled={busy} onPress={()=>router.back()}/>
  </ToolPage>;
}
