import {useEffect,useState} from 'react';
import {Pressable,ScrollView,Text,useWindowDimensions,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {router} from 'expo-router';
import {useAppearance} from '../lib/appearance';
import {api} from '../lib/api';
import {getDeviceCacheRevision} from '../lib/device-cache';
import {MediaImage} from './media-image';
import {ToolButton} from './toolkit';
import {shareItem} from '../lib/share-content';

export type PreviewProduct={id:string;vendor_profile_id:string;name:string;description:string;category:string;price_kobo:number;stock_quantity:number;image_url:string|null;image_urls?:string[];vendor_name:string;pickup_location?:string;rating?:number;review_count?:number};
type Seller={biography?:string|null;pickup_location?:string|null;rating?:number;review_count?:number};
const money=(kobo:number)=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:2}).format(kobo/100);

export function ProductPreview({product,quantity,onAdd,onClose}:{product:PreviewProduct;quantity:number;onAdd:()=>void;onClose:()=>void}){
  const {theme}=useAppearance(),{width}=useWindowDimensions();
  const galleryWidth=Math.min(Math.max(240,width-32),540);
  const [seller,setSeller]=useState<Seller|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const photos=[...new Set([product.image_url,...(Array.isArray(product.image_urls)?product.image_urls:[])].filter((uri):uri is string=>typeof uri==='string'&&/^https:\/\//i.test(uri)))].slice(0,6);
  useEffect(()=>{
    let active=true;const revision=getDeviceCacheRevision();
    void api<{service:Seller}>('/v1/people/services/'+product.vendor_profile_id,{timeoutMs:8000}).then(result=>{if(active&&revision===getDeviceCacheRevision()){setSeller(result.service);setError('');}}).catch(()=>{if(active&&revision===getDeviceCacheRevision())setError('Seller information could not refresh.');});
    return()=>{active=false;};
  },[product.vendor_profile_id,attempt]);
  const text={color:theme.text,fontFamily:theme.font.body,fontSize:15,lineHeight:23},stock=Number(product.stock_quantity),available=stock>0;
  function sellerProfile(){onClose();router.push({pathname:'/student-service',params:{id:product.vendor_profile_id}});}
  return <SafeAreaView style={{flex:1,backgroundColor:theme.canvas}} edges={['top','bottom']}>
    <View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:8,gap:12}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close product preview" onPress={onClose} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="arrow-back" size={24} color={theme.text}/></Pressable>
      <Text style={{...text,flex:1,fontFamily:theme.font.semibold}}>Product details</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Share product" onPress={()=>void shareItem('product',product.id,product.name).catch(()=>undefined)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="share-outline" size={23} color={theme.text}/></Pressable>
    </View>
    <ScrollView contentContainerStyle={{padding:16,gap:24,alignSelf:'center',width:'100%',maxWidth:572,paddingBottom:24}}>
      {photos.length?<View style={{gap:8}}><ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{width:galleryWidth,borderRadius:16}}>{photos.map((uri,index)=><MediaImage key={uri} uri={uri} resizeMode="contain" accessibilityLabel={`${product.name}, photo ${index+1} of ${photos.length}`} style={{width:galleryWidth,height:galleryWidth}}/>)}</ScrollView><Text style={{...text,color:theme.textMuted,fontSize:12}}>{photos.length===1?'1 product photo':`${photos.length} photos · Swipe to see them all`}</Text></View>:<View style={{height:240,borderRadius:16,backgroundColor:theme.surfaceMuted,alignItems:'center',justifyContent:'center',gap:8}}><Ionicons name="image-outline" size={40} color={theme.textMuted}/><Text style={text}>No product photo available</Text></View>}
      <View style={{gap:8}}><Text style={{...text,color:theme.accentText,fontSize:13}}>{product.category}</Text><Text accessibilityRole="header" style={{...text,fontFamily:theme.font.displayStrong,fontSize:28,lineHeight:34}}>{product.name}</Text><Text style={{...text,fontFamily:theme.font.semibold,fontSize:24,lineHeight:32}}>{money(Number(product.price_kobo))}</Text><Text style={{...text,color:available?theme.success:theme.error}}>{available?`${stock} in stock`:'Out of stock'}</Text></View>
      <View style={{gap:8}}><Text style={{...text,fontFamily:theme.font.semibold}}>About this product</Text><Text selectable style={text}>{product.description||'The seller has not added a description.'}</Text></View>
      <View style={{padding:16,gap:8,backgroundColor:theme.surface,borderColor:theme.border,borderWidth:1,borderRadius:16}}><Text style={{...text,fontSize:12,color:theme.textMuted}}>SOLD BY</Text><Pressable accessibilityRole="button" onPress={sellerProfile} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:8}}><Ionicons name="storefront-outline" color={theme.accentText} size={22}/><Text style={{...text,fontFamily:theme.font.semibold,flex:1}}>{product.vendor_name}</Text><Ionicons name="chevron-forward" size={20} color={theme.textMuted}/></Pressable>{seller?.biography?<Text style={text}>{seller.biography}</Text>:null}{(seller?.pickup_location||product.pickup_location)?<Text style={{...text,color:theme.textMuted}}>Pickup: {seller?.pickup_location||product.pickup_location}</Text>:null}{Number(seller?.review_count??product.review_count)>0?<Text style={{...text,color:theme.textMuted}}>{Number(seller?.rating??product.rating).toFixed(1)} / 5 · {seller?.review_count??product.review_count} purchase reviews</Text>:<Text style={{...text,color:theme.textMuted}}>No purchase reviews yet</Text>}{error?<><Text style={{...text,color:theme.textMuted}}>{error}</Text><ToolButton secondary label="Retry seller details" onPress={()=>setAttempt(n=>n+1)}/></>:null}</View>
    </ScrollView>
    <View style={{paddingHorizontal:16,paddingVertical:12,borderTopWidth:1,borderTopColor:theme.border,backgroundColor:theme.surface,gap:8}}>{quantity?<Text accessibilityLiveRegion="polite" style={{...text,textAlign:'center',fontSize:13}}>{quantity} in your cart</Text>:null}<ToolButton label={!available?'Out of stock':quantity>=stock?'All available stock is in your cart':quantity?'Add another':'Add to cart'} disabled={!available||quantity>=stock} onPress={onAdd}/></View>
  </SafeAreaView>;
}
