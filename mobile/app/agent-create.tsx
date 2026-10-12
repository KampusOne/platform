import { useAuth } from "@/src/auth/auth-context";
import { writeCache } from "@/src/lib/device-cache";
import { useOwnedDraftSave } from '@/src/lib/use-owned-draft-save';
import { useOwnedDraftRestore } from '@/src/lib/use-owned-draft-restore';
import { restoreListingDraft } from '@/src/lib/form-drafts';
import { moveListingPhoto } from '@/src/lib/listing-photos';
import { DraftRecovery } from '@/src/components/draft-recovery';
import { MediaImage } from '@/src/components/media-image';
import { ImageViewer } from '@/src/components/image-viewer';
import { cacheScopeForUser } from '@/src/lib/request-policy';
import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { nairaToKobo } from '@/src/lib/money-input';
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { pickAndUpload } from "@/src/lib/uploads";
export default function CreateListing() {
  const {user}=useAuth(),{role}=useLocalSearchParams<{role:string}>();
  return <CreateListingForm key={(user?cacheScopeForUser(user):'signed-out')+':'+(role==='TUTOR'?'tutor':'vendor')}/>;
}
function CreateListingForm() {
  const { role } = useLocalSearchParams<{ role: string }>();
  const tutor = role === "TUTOR";
  const {user}=useAuth();
  const draftKey=`listing-draft.${user?.id}.${tutor?"tutor":"vendor"}`;
  const currentDraftKey=useRef(draftKey);
  currentDraftKey.current=draftKey;
  const requestPayload=useRef("");
  const formLock=useRef(false);
  const draftCompleted=useRef(false);
  const { theme } = useAppearance();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("1");
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [images,setImages]=useState<string[]>([]);
  const image=images[0]??'';
  const [photoPreview,setPhotoPreview]=useState<string|null>(null);
  const requestId=useRef(randomUUID());
  const createdId=useRef<string|null>(null);
  useEffect(()=>{
    createdId.current=null;requestId.current=randomUUID();requestPayload.current="";
    formLock.current=false;draftCompleted.current=false;setBusy(false);
    setName("");setDescription("");setPrice("");setStock("1");setCode("");setLocation("");setImages([]);setPhotoPreview(null);setCategory("");setCategoryQuery("");setShowAllCategories(false);
  },[draftKey]);
  const restored=useOwnedDraftRestore<unknown>(draftKey,value=>{
    if(value===null)return;
    const d=restoreListingDraft(value);
    setName(d.name??'');setDescription(d.description??'');setPrice(d.price??'');setStock(d.stock||'1');setCode(d.code??'');setLocation(d.location??'');setImages(d.images);setCategory(d.category??'');
    createdId.current=d.createdId??null;requestId.current=d.requestId??randomUUID();requestPayload.current=d.requestPayload??'';
  },Boolean(user?.id));
  const draftReady=restored.ready;
  const [pricePreview,setPricePreview]=useState<{ready:boolean;baseKobo:number;platformKobo:number;processingEstimateKobo:number;customerEstimateKobo:number;sellerCommissionKobo:number}|null>(null);
  useEffect(()=>{
    if(tutor||!price.trim()){setPricePreview(null);return;}
    let valid=true,amount:number;try{amount=nairaToKobo(price);}catch{setPricePreview(null);return;}
    const timer=setTimeout(()=>void api<typeof pricePreview>('/v1/agents/products/price-preview?priceKobo='+amount).then(r=>{if(valid)setPricePreview(r);}).catch(()=>{if(valid)setPricePreview(null);}),300);
    return()=>{valid=false;clearTimeout(timer);};
  },[price,tutor]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [category, setCategory] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const alive = useRef(true), categoryRequest = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; categoryRequest.current++; }; }, []);
  const [busy, setBusy] = useState(false);
  const listingDraft={name,description,price,stock,code,location,image,images,category,createdId:createdId.current,requestId:requestId.current,requestPayload:requestPayload.current};
  const draftSave=useOwnedDraftSave(draftKey,listingDraft,draftReady&&Boolean(user?.id)&&!busy&&!draftCompleted.current);
  const loadCategories = useCallback(async () => {
    const turn = ++categoryRequest.current;
    setCategoriesLoading(true); setCategoriesError("");
    try {
      const result = await api<{ categories: { id: string; name: string }[] }>("/v1/agents/product-categories", { cache: "reload" });
      if (!alive.current || turn !== categoryRequest.current) return;
      setCategories(result.categories);
      setCategory(current => result.categories.some(c => c.id === current) ? current : "");
      if (!result.categories.length) setCategoriesError("No approved categories are available for your campus yet. Contact support or try again later.");
    } catch (e) {
      if (alive.current && turn === categoryRequest.current) setCategoriesError(e instanceof Error ? e.message : "Product categories could not load.");
    } finally {
      if (alive.current && turn === categoryRequest.current) setCategoriesLoading(false);
    }
  }, [draftKey]);
  useEffect(() => { if (!tutor) void loadCategories(); }, [tutor, loadCategories]);
  let formHint = "";
  if(tutor&&code.trim().length<2)formHint="Add a course code.";
  else if (!tutor && !categories.length) formHint = categoriesLoading ? "Loading product categories…" : "Load product categories to finish your listing.";
  else if (!tutor && !category) formHint = "Choose a product category below.";
  else if (!tutor && !image) formHint = "Add at least one product photo.";
  else if (name.trim().length < (tutor?3:2)) formHint = tutor?"Enter a title with at least 3 characters.":"Enter a name with at least 2 characters.";
  else if (description.trim().length < (tutor?20:10)) formHint = tutor?"Add a description with at least 20 characters.":"Add a description with at least 10 characters.";
  else {
    try { nairaToKobo(price); } catch (e) { formHint = e instanceof Error ? e.message : "Enter a valid price."; }
    if (!formHint && (!/^\d+$/.test(stock.trim()) || Number(stock) > (tutor ? 500 : 1_000_000) || Number(stock) < (tutor ? 1 : 0))) formHint = tutor ? "Enter 1 to 500 available places." : "Enter a whole stock quantity from 0 to 1,000,000.";
  }
  if(createdId.current)formHint="";
  const fieldsLocked=busy||!draftReady||Boolean(createdId.current);
  async function upload() {
    if(formLock.current||fieldsLocked||images.length>=6)return;
    const operationKey=draftKey;
    formLock.current=true;setBusy(true);
    try {
      const file = await pickAndUpload("product");
      if(alive.current&&currentDraftKey.current===operationKey&&file)setImages(current=>current.includes(file.url)?current:[...current,file.url].slice(0,6));
    } catch (e) {
      if(alive.current&&currentDraftKey.current===operationKey)toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      if(alive.current&&currentDraftKey.current===operationKey){formLock.current=false;setBusy(false);}
    }
  }
  async function save() {
    if (formLock.current || busy || !draftReady || formHint) return;
    const operationKey=draftKey;
    const stillCurrent=()=>alive.current&&currentDraftKey.current===operationKey;
    formLock.current=true;setBusy(true);
    try {
      const path = tutor ? "/v1/agents/tutorials" : "/v1/agents/products";
      const body = tutor
        ? {
            requestId:requestId.current,
            courseCode: code,
            title: name,
            description,
            format: "IN_PERSON",
            priceKobo: nairaToKobo(price),
            capacity: Number(stock),
            locationText: location,
          }
        : {
            name,
            description,
            category: categories.find((c) => c.id === category)?.name,
            categoryId: category,
            priceKobo: nairaToKobo(price),
            stockQuantity: Number(stock),
            imageUrl: image || null,
            imageUrls:images,
            requestId:requestId.current,
          };
      const {requestId: _previous,...details}=body;
      const signature=JSON.stringify(details);
      if(!createdId.current&&requestPayload.current!==signature){requestId.current=randomUUID();requestPayload.current=signature;}
      body.requestId=requestId.current;
      await draftSave.persist({...listingDraft,requestId:requestId.current,requestPayload:signature});
      if(!stillCurrent())return;
      const created = createdId.current?{id:createdId.current}:await api<{ id: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if(!stillCurrent())return;
      createdId.current=created.id;
      await draftSave.persist({...listingDraft,createdId:created.id,requestId:requestId.current,requestPayload:signature});
      if(!stillCurrent())return;
      if(tutor)await api(path + "/" + created.id + "/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "SUBMITTED" }),
      });
      if(!stillCurrent())return;
      draftCompleted.current=true;draftSave.discard();
      await writeCache(draftKey,null);
      toast(tutor?"Submitted for review":"Product uploaded", "success");
      router.back();
    } catch (e) {
      if(stillCurrent())toast(e instanceof Error ? e.message : "Could not save listing", "error");
    } finally {
      if(stillCurrent()){formLock.current=false;setBusy(false);}
    }
  }
  const matchingCategories = categories.filter(c=>c.name.toLocaleLowerCase("en-NG").includes(categoryQuery.trim().toLocaleLowerCase("en-NG")));
  const visibleCategories = categoryQuery.trim() || showAllCategories ? matchingCategories : matchingCategories.slice(0,8);
  return (
    <ToolPage title={tutor ? "Create tutorial" : "Create product"}>
      <DraftRecovery error={restored.error} loading={restored.loading} onRetry={restored.retry}/>
      {draftSave.warning?<Text accessibilityRole="alert" style={{fontFamily:theme.font.body,color:theme.error,lineHeight:21,marginBottom:12}}>{draftSave.warning}</Text>:null}
      <View style={{ padding:16, borderRadius:16, borderWidth:1, borderColor:theme.border,
        backgroundColor:theme.surface, marginBottom:20, gap:6 }}>
        <Text style={{ fontFamily:theme.font.semibold, color:theme.deepBrand, fontSize:12 }}>
          {tutor?"TUTOR WORKSPACE":"SELLER WORKSPACE"} · NEW LISTING
        </Text>
        <Text style={{ fontFamily:theme.font.displayStrong, color:theme.text, fontSize:21 }}>
          {tutor?"Share your knowledge":"Make your product easy to discover"}
        </Text>
        <Text style={{ fontFamily:theme.font.body, color:theme.textMuted, lineHeight:20, fontSize:13 }}>
          {tutor?"Describe the tutorial, set your price and submit for approval.":
            "Good photos, an honest description and accurate stock help students decide."}
        </Text>
      </View>
      {!tutor ? (
        <>
          <View style={{padding:18,borderRadius:22,backgroundColor:theme.surfaceTint,gap:8,marginBottom:20}}><Text style={{fontFamily:theme.font.displayStrong,fontSize:24,color:theme.text}}>Ready for your next sale</Text><Text style={{fontFamily:theme.font.body,lineHeight:22,color:theme.textMuted}}>Add clear photos and a price. Your product goes live when you upload it.</Text></View>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:12,marginBottom:18}}>
            {images.map((url,index)=><View key={url} style={{width:'47%',gap:6}}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Preview product photo ${index+1}`} onPress={()=>setPhotoPreview(url)} style={{aspectRatio:1,borderRadius:16,overflow:'hidden'}}><MediaImage uri={url} accessibilityLabel={`Product photo ${index+1}`} style={{width:'100%',aspectRatio:1}}/></Pressable>
              <Text style={{fontFamily:theme.font.semibold,color:index===0?theme.deepBrand:theme.textMuted,fontSize:12}}>{index===0?'Cover photo':`Photo ${index+1}`}</Text>
              <View style={{flexDirection:'row',gap:4}}>{([-1,1] as const).map(direction=><Pressable key={direction} accessibilityRole="button" accessibilityLabel={`Move photo ${index+1} ${direction<0?'earlier':'later'}`} accessibilityState={{disabled:fieldsLocked||index+direction<0||index+direction>=images.length}} disabled={fieldsLocked||index+direction<0||index+direction>=images.length} onPress={()=>setImages(current=>moveListingPhoto(current,index,index+direction))} style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:8,backgroundColor:theme.surfaceMuted,opacity:fieldsLocked||index+direction<0||index+direction>=images.length?0.4:1}}><Ionicons name={direction<0?'arrow-back':'arrow-forward'} size={18} color={theme.text}/></Pressable>)}</View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${index+1}`} disabled={fieldsLocked} onPress={()=>setImages(current=>current.filter((_,i)=>i!==index))} style={{minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:8,borderWidth:1,borderColor:theme.border,flexDirection:'row',gap:6}}><Ionicons name="close" size={16} color={theme.text}/><Text style={{fontFamily:theme.font.body,color:theme.text,fontSize:12}}>Remove</Text></Pressable>
            </View>)}
            {images.length<6?<Pressable accessibilityRole="button" accessibilityLabel="Add product photo" disabled={fieldsLocked} onPress={()=>void upload()} style={{width:'47%',aspectRatio:1,borderRadius:18,borderWidth:1,borderStyle:'dashed',borderColor:theme.deepBrand,alignItems:'center',justifyContent:'center',gap:8,backgroundColor:theme.surface}}><Ionicons name="camera-outline" size={28} color={theme.deepBrand}/><Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand}}>{busy?'Uploading…':'Add photo'}</Text></Pressable>:null}
          </View>
          <Text style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:12,lineHeight:18,marginBottom:16}}>Tap a photo to preview it. Move a photo to the first position to use it as the cover.</Text>
          <ImageViewer uri={photoPreview} label="Product photo preview" onClose={()=>setPhotoPreview(null)}/>
        </>
      ) : null}
      <Text style={{ fontFamily:theme.font.semibold, color:theme.deepBrand, fontSize:12, marginBottom:10 }}>01 · DETAILS</Text>
      <ToolField editable={!fieldsLocked}
        label={tutor ? "Tutorial title" : "Product name"}
        value={name}
        onChangeText={setName}
        maxLength={160}
      />
      <ToolField editable={!fieldsLocked}
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />
      <Text style={{ fontFamily:theme.font.semibold, color:theme.deepBrand, fontSize:12, marginBottom:10 }}>02 · PRICE & AVAILABILITY</Text>
      <ToolField editable={!fieldsLocked}
        label="Price (₦)"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <ToolField editable={!fieldsLocked}
        label={tutor ? "Available places" : "Stock quantity"}
        value={stock}
        onChangeText={setStock}
        keyboardType="number-pad"
      />
      {tutor ? (
        <>
          <ToolField editable={!fieldsLocked} label="Course code" value={code} onChangeText={setCode} />
          <ToolField editable={!fieldsLocked}
            label="Location"
            value={location}
            onChangeText={setLocation}
          />
        </>
      ) : (
        <View style={{ gap: 10, marginBottom: 16 }}>
        <Text style={{ fontFamily: theme.font.semibold, color: theme.text }}>Product category (required)</Text>
        {categoriesLoading ? <Text style={{ color: theme.textMuted }}>Loading categories…</Text> : null}
        {categoriesError ? <><Text accessibilityRole="alert" style={{ color: theme.error, lineHeight: 22 }}>{categoriesError}</Text><ToolButton secondary label="Retry product categories" disabled={categoriesLoading} onPress={() => void loadCategories()} /></> : null}
        {categories.length > 8 ? <ToolField label="Find a category" value={categoryQuery} onChangeText={setCategoryQuery} placeholder="Books, materials, clothing…" /> : null}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {visibleCategories.map((c) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={c.name}
              accessibilityState={{ selected: category === c.id, disabled: fieldsLocked }}
              disabled={fieldsLocked}
              key={c.id}
              onPress={() => setCategory(c.id)}
              style={{
                padding: 13,
                borderRadius: 10,
                backgroundColor: category === c.id ? theme.sand : theme.surface,
              }}
            >
              <Text style={{ color: theme.text }}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
        {!categoryQuery.trim()&&!showAllCategories&&matchingCategories.length>visibleCategories.length ?
          <ToolButton secondary label={`Show all ${matchingCategories.length} categories`} onPress={()=>setShowAllCategories(true)}/> : null}
        {categories.length > 0 && !matchingCategories.length ? <Text style={{ color: theme.textMuted }}>No matching category. Try another word.</Text> : null}
        </View>
      )}
      {!tutor&&pricePreview?.ready?<View style={{padding:18,borderRadius:18,backgroundColor:theme.surface,borderColor:theme.border,borderWidth:1,gap:8,marginBottom:18}}><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>Price preview</Text>{[['Your price',pricePreview.baseKobo],['KampusOne service fee',pricePreview.platformKobo],['Estimated processing fee',pricePreview.processingEstimateKobo],['Customer estimate',pricePreview.customerEstimateKobo]].map(([label,amount])=><View key={String(label)} style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{fontFamily:theme.font.body,color:theme.textMuted}}>{label}</Text><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>₦{(Number(amount)/100).toLocaleString('en-NG',{maximumFractionDigits:2})}</Text></View>)}<Text style={{fontFamily:theme.font.body,fontSize:12,lineHeight:18,color:theme.textMuted}}>Checkout confirms the total and any processing fee.</Text></View>:null}
      {createdId.current ? <Text accessibilityRole="alert" style={{color:theme.textMuted,lineHeight:22,marginBottom:12}}>Your listing was created. Retry to finish submitting it for review.</Text> : null}
      <ToolButton
        label={busy ? "Saving…" : createdId.current?"Retry submission":tutor?"Submit for review":"Upload product"}
        disabled={busy || !draftReady || Boolean(formHint)}
        onPress={() => void save()}
      />
      {!busy && formHint ? <Text style={{ color: theme.textMuted, lineHeight: 22, marginTop: 10 }}>{formHint}</Text> : null}
    </ToolPage>
  );
}
