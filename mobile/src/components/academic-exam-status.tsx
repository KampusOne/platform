import { useCallback,useState } from 'react';
import { useFocusEffect,router } from 'expo-router';
import { Pressable,Text,View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
type Exam={semester:string;startsOn:string;endsOn:string;status:'upcoming'|'ongoing'|'completed'};
export function AcademicExamStatus(){
 const {theme}=useAppearance(),[period,setPeriod]=useState<Exam|null>(null);
 useFocusEffect(useCallback(()=>{let live=true;void api<{examPeriods:Exam[]}>('/v1/calendar/exam-periods').then(data=>{if(live)setPeriod(data.examPeriods.find(p=>p.status==='ongoing')??data.examPeriods.find(p=>p.status==='upcoming')??null);}).catch(()=>undefined);return()=>{live=false;};},[]));
 if(!period)return null;
 const date=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
 return <Pressable accessibilityRole="button" accessibilityLabel="View your exam period in the academic calendar" onPress={()=>router.push('/academic-calendar')} style={{marginTop:12,marginBottom:12,padding:16,borderWidth:1,borderColor:theme.border,borderRadius:16,backgroundColor:theme.surfaceMuted,flexDirection:'row',gap:12,alignItems:'center'}}><Ionicons name="calendar-outline" size={25} color={theme.deepBrand}/><View style={{flex:1,gap:4}}><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>{period.status==='ongoing'?'Exam period is underway':'Your next exam period'}</Text><Text style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:12,lineHeight:18}}>{date(period.startsOn)} to {date(period.endsOn)}</Text></View><Ionicons name="chevron-forward" size={18} color={theme.textMuted}/></Pressable>;
}
