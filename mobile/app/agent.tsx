import {VendorAnalytics} from "@/src/components/vendor-analytics";
import { useLiveRefresh } from "@/src/lib/live-updates";
import {shareAgentLocation} from '@/src/lib/agent-location';
import { BrandSwitch } from "@/src/components/brand-switch";
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Alert, AppState, Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from '@expo/vector-icons';
import { MediaImage } from '@/src/components/media-image';
import { RetryIconButton } from '@/src/components/retry-icon-button';
import { cacheScopeForUser } from '@/src/lib/request-policy';
import {
  ToolPage,
  ToolButton,
  ToolField,
} from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { useCapabilities } from "@/src/components/agent-shortcuts";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { HeaderMenu } from "@/src/components/header-menu";
import { ScreenSkeleton } from "@/src/components/skeleton";
type Item = {
  id: string;
  title?: string;resource_type?:string;
  name?: string;
  zone_name?: string;
  store_name?: string;
  vendor_name?: string;
  vendor_user_id?: string;
  vendor_phone?: string | null;
  vendor_whatsapp?: string | null;
  delivery_location?: string | null;
  pickup_location?: string;
  delivery_note?: string;
  price_kobo?: number;
  image_url?: string | null;
  image_urls?: string[];
  cover_url?: string | null;
  access_model?: string;
  rider_earning_kobo?: number;
  commission_kobo?: number;
  fare_kobo?: number;
  fare_payment_method?: "IN_APP" | "CASH";
  pickups?:{vendor_name:string;address:string;phone:string|null;whatsapp:string|null;items:{name:string;quantity:number}[]}[];
  status: string;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    value / 100,
  );
export default function AgentDashboard() {
  const { user } = useAuth();
  const {role}=useLocalSearchParams<{role?:string}>();
  return <AccountAgentDashboard key={(user?cacheScopeForUser(user):'anonymous')+':'+(role??'default')} />;
}
function AccountAgentDashboard() {
  const { role: requested } = useLocalSearchParams<{ role?: string }>();
  const caps = useCapabilities();
  const profile =
    requested ? caps.profiles.find((p) => p.agent_type === requested) : caps.profiles[0];
  const role = profile?.agent_type;
  const temporarilySuspended=profile?.status==='PAUSED';
  const seller = role === "VENDOR" || requested === "VENDOR";
  const { theme } = useAppearance();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [rideTab, setRideTab] = useState<"AVAILABLE" | "ACTIVE" | "HISTORY">(
    "AVAILABLE",
  );
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locationStatus,setLocationStatus]=useState("Share your current location for delivery routes.");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [ridesSuspended, setRidesSuspended] = useState(false);
  const mounted=useRef(true),readVersion=useRef(0),deleteLock=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;readVersion.current++;};},[]);
  const load = useCallback(async () => {
    if (!role) return;
    const version=++readVersion.current;
    const r = await api<{
      products?: Item[];
      listings?: Item[];
      resources?: Item[];
      jobs?: Item[];
      presence?: { online: boolean };
      finance?: { rides_suspended: boolean } | null;
    }>(
      "/v1/agents/" +
        (role === "VENDOR"
          ? "products"
          : role === "TUTOR"
            ? "tutorials"
            : "deliveries"),
      {cache:'reload'},
    );
    if(!mounted.current||version!==readVersion.current)return;
    setItems(role==='TUTOR'?[...(r.resources??[]),...(r.listings??[])]:r.products??r.jobs??[]);
    setOnline(r.presence?.online ?? false);
    setRidesSuspended(r.finance?.rides_suspended ?? false);
    setReady(true);
    setLoadError("");
  }, [role]);
  async function deleteListing(item:Item){
    if(!mounted.current||busy||deleteLock.current||temporarilySuspended||!['VENDOR','TUTOR'].includes(role??''))return;
    deleteLock.current=true;
    setBusy(true);
    const product=role==='VENDOR',noun=product?'Product':item.resource_type?'Material':'Tutorial';
    try{
      try{
        await api('/v1/agents/'+(product?'products/':item.resource_type?'tutorial-resources/':'tutorials/')+encodeURIComponent(item.id)+(product?'/status':''),
          product?{method:'PATCH',body:JSON.stringify({status:'ARCHIVED'})}:{method:'DELETE'});
      }
      catch(error){
        const fresh=await api<{products?:Item[];resources?:Item[];listings?:Item[]}>('/v1/agents/'+(product?'products':'tutorials'),{cache:'reload'}).catch(()=>null);
        if(!mounted.current)return;
        const remaining=product?fresh?.products:item.resource_type?fresh?.resources:fresh?.listings;
        if(!Array.isArray(remaining)||remaining.some(p=>p.id===item.id))throw error;
      }
      if(!mounted.current)return;
      readVersion.current++;setItems(current=>current.filter(p=>p.id!==item.id||p.resource_type!==item.resource_type));toast(noun+' deleted','success');
    }catch(error){if(mounted.current)toast(error instanceof Error?error.message:noun+' could not be deleted.','error');}
    finally{deleteLock.current=false;if(mounted.current)setBusy(false);}
  }
  function confirmDelete(item:Item){
    const product=role==='VENDOR',noun=product?'product':item.resource_type?'material':'tutorial';
    Alert.alert(`Delete ${noun}?`,`Remove “${item.name??item.title??'this '+noun}” from your listings? Existing purchases and bookings are kept.`,[
      {text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void deleteListing(item)},
    ]);
  }
  function editListing(item: Item) {
    if (role === 'VENDOR') router.push({ pathname: '/agent-create', params: { role: 'VENDOR', id: item.id } });
    else router.push({ pathname: '/tutor-edit', params: { id: item.id, kind: item.resource_type ? 'resource' : 'tutorial' } });
  }
  function openListing(item: Item) {
    if (role === 'VENDOR') {
      if (item.status === 'PUBLISHED') router.push({ pathname: '/(tabs)/store', params: { product: item.id } });
      else editListing(item);
    } else if (item.resource_type) {
      if (item.status === 'PUBLISHED') router.push({ pathname: '/learning-preview', params: { id: item.id } });
      else editListing(item);
    } else router.push({ pathname: '/tutorial-manage', params: { id: item.id } });
  }
  useFocusEffect(
    useCallback(() => {
      const refresh = () =>
        void load().catch((e) => {
          setLoadError(e.message);
          setReady(true);
        });
      refresh();
      return () => undefined;
    }, [load, role]),
  );
  useFocusEffect(useCallback(()=>{
    if(role!=='RIDER'||!online||!profile?.id)return;
    let active=true,pending=false;
    const refresh=async()=>{if(!active||pending||AppState.currentState!=='active')return;pending=true;try{await shareAgentLocation(profile.id,false);if(active)setLocationStatus('Current location shared while this screen is open.');}catch(e){if(active)setLocationStatus(e instanceof Error?e.message:'Refresh your location for rider routes.');}finally{pending=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{active=false;clearInterval(timer);};
  },[role,online,profile?.id]));
  useLiveRefresh("/v1/agents", () => load().catch(e => { setLoadError(e.message); setReady(true); }), 90_000, role === "RIDER");
  async function refreshPosition(){if(!profile)return;setBusy(true);try{await shareAgentLocation(profile.id);setLocationStatus('Current location shared for delivery routes.');}catch(e){toast(e instanceof Error?e.message:'Location could not refresh.','error');}finally{setBusy(false);}}
  async function reviewPickup(item:Item){setBusy(true);try{if(!profile)return;await shareAgentLocation(profile.id);router.push({pathname:'/delivery-route',params:{jobId:item.id}});}catch(e){toast(e instanceof Error?e.message:'Pickup route could not be reviewed.','error');}finally{setBusy(false);}}

  async function action(item: Item, type: string) {
    setBusy(true);
    try {
      if(type==="reserve"&&profile)await shareAgentLocation(profile.id);
      await api("/v1/agents/deliveries/" + item.id + "/" + type, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setSelected(null);
      setCode("");
      await load();
      toast("Delivery updated", "success");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not update delivery",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function availability(value: boolean) {
    setBusy(true);
    try {
      if(value&&profile)await shareAgentLocation(profile.id);
      await api("/v1/agents/rider-presence", {
        method: "PUT",
        body: JSON.stringify({ online: value, capacityStatus: "AVAILABLE" }),
      });
      setOnline(value);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not update availability",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage
      title={
        seller
          ? "Seller dashboard"
          : role === "TUTOR"
            ? "Tutor dashboard"
            : role === "RIDER"
              ? "Available rides"
              : "Your workspaces"
      }
      action={role==='RIDER'?<HeaderMenu label="Rider options" items={[
        {label:online?'Go offline':'Go online for deliveries',icon:'bicycle-outline',disabled:busy||temporarilySuspended,onPress:()=>void availability(!online)},
        {label:'Refresh delivery location',icon:'locate-outline',disabled:busy||temporarilySuspended,onPress:()=>void refreshPosition()},
        {label:'Refresh available rides',icon:'refresh-outline',onPress:()=>void load().catch(e=>setLoadError(e.message))},
      ]}/>:seller ? <HeaderMenu label="Seller dashboard options" items={[
        { label: "Refresh dashboard", icon: "refresh-outline", onPress: () => void load().catch(e => setLoadError(e.message)), disabled: !profile || busy },
        { label: "Refresh delivery location", icon: "locate-outline", onPress: () => void refreshPosition(), disabled: !profile || busy },
        { label: "Campus capture missions", icon: "map-outline", onPress: () => router.push("/map-capture"), disabled: !profile },
      ]} /> : role === 'TUTOR' ? <HeaderMenu label="Tutor dashboard options" items={[
        { label: "Refresh dashboard", icon: "refresh-outline", onPress: () => void load().catch(e => setLoadError(e.message)), disabled: busy },
        { label: "View tutor profile", icon: "person-circle-outline", onPress: () => router.push({ pathname: '/student-service', params: { id: profile!.id } }) },
        { label: "Set up booking times & fee", icon: "calendar-outline", disabled: temporarilySuspended, onPress: () => router.push({ pathname: '/agent-create', params: { role: 'TUTOR' } }) },
        { label: "Free trial", icon: "gift-outline", onPress: () => router.push('/trial') },
        ...caps.profiles.filter(p => p.id !== profile?.id).map(p => ({ label: `Open ${p.agent_type.toLowerCase()} dashboard`, icon: 'swap-horizontal-outline' as const, onPress: () => router.setParams({ role: p.agent_type }) })),
      ]} /> : undefined}
    >
      {!caps.ready ? <ScreenSkeleton variant="list" compact /> : <>
      {profile ? <View style={{ gap: 5, paddingVertical: 14 }}>
        <Text style={{ color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 23 }}>{profile.display_name}</Text>
        <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, lineHeight: 20 }}>
          {role==="VENDOR"?"Manage listings, orders and earnings.":
            role==="TUTOR"?"Manage your teaching, learners and bookings.":
            "Manage your availability, pickup routes and deliveries."}
        </Text>
      </View> : null}
      {temporarilySuspended ? <View accessibilityRole="alert" style={{padding:18,marginBottom:18,borderRadius:16,backgroundColor:theme.surfaceTint,gap:8}}><Text style={{color:theme.deepBrand,fontFamily:theme.font.semibold}}>Temporarily suspended until {new Date(profile.suspension_ends_at!).toLocaleDateString('en-NG')}</Text><Text style={{color:theme.text}}>{profile.suspension_reason} You can view your account. Uploads, changes and withdrawals resume after the suspension.</Text></View> : null}
      {profile?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:18}}>{[
        {label:'Orders',icon:'receipt-outline' as const,path:role==='VENDOR'?'/vendor-orders':role==='TUTOR'?'/tutor-learners':'/agent'},
        {label:'Earnings',icon:'wallet-outline' as const,path:'/earnings'},
        {label:'Profile',icon:'person-outline' as const,path:role==='VENDOR'?'/store-settings':'/business-profile-edit'},
        {label:'Bank',icon:'card-outline' as const,path:'/bank-account'},
      ].map(action=><Pressable key={action.label} accessibilityRole="button" onPress={()=>router.push({pathname:action.path as '/earnings',params:{profileId:profile.id}})} style={{flex:1,minWidth:65,alignItems:'center',gap:6,paddingVertical:14,backgroundColor:theme.surface,borderWidth:1,borderColor:theme.border,borderRadius:12}}><Ionicons name={action.icon} size={22} color={theme.deepBrand}/><Text style={{color:theme.text,fontFamily:theme.font.semibold,fontSize:12}}>{action.label}</Text></Pressable>)}</View>:null}
      {ready&&profile&&!loadError ? <View style={{ flexDirection:"row", gap:10, marginBottom:16 }}>
        <View style={{ flex:1, backgroundColor:theme.surfaceTint, padding:16, borderRadius:15 }}>
          <Text style={{ fontFamily:theme.font.displayStrong, color:theme.deepBrand, fontSize:27 }}>
            {role==="RIDER" ? items.filter(i=>i.status==="AVAILABLE").length : items.length}
          </Text>
          <Text style={{ color:theme.textMuted, fontFamily:theme.font.body, fontSize:12 }}>
            {role==="RIDER"?"Available requests":role==="TUTOR"?"Tutorial listings":"Product listings"}
          </Text>
        </View>
        <View style={{ flex:1, backgroundColor:theme.surface, borderColor:theme.border, borderWidth:1,
          padding:16, borderRadius:15 }}>
          <Text style={{ fontFamily:theme.font.displayStrong, color:theme.text, fontSize:27 }}>
            {role==="RIDER" ? items.filter(i=>["RESERVED","PICKED_UP"].includes(i.status)).length :
              items.filter(i=>["ACTIVE","PUBLISHED","APPROVED"].includes(i.status)).length}
          </Text>
          <Text style={{ color:theme.textMuted, fontFamily:theme.font.body, fontSize:12 }}>
            {role==="RIDER"?"In progress":"Active listings"}
          </Text>
        </View>
      </View> : null}
      {role === "VENDOR" && caps.profiles.length > 1 && (
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
          {caps.profiles.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: role === p.agent_type }}
              onPress={() => router.setParams({ role: p.agent_type })}
              style={{
                padding: 12,
                borderBottomWidth: 2,
                borderColor:
                  role === p.agent_type ? theme.brand : "transparent",
              }}
            >
              <Text style={{ color: theme.text }}>
                {p.agent_type.toLowerCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {(loadError || caps.error) && (
        <View style={{ marginVertical: 14 }}>
          <Text style={{ color: theme.text }}>{loadError || caps.error}</Text>
          <RetryIconButton label="Refresh dashboard" onPress={() => void load().catch((e) => setLoadError(e.message))}/>
        </View>
      )}
      {caps.ready && !role && !caps.error && (
        <EmptyResult
          title="No approved role yet"
          body="Your workspaces appear here once your agent application is approved."
        />
      )}
      {role==='VENDOR'?<VendorAnalytics/>:null}
      {role === "RIDER" && ridesSuspended ? (
        <View style={{ paddingVertical: 16 }}>
          <Text style={{ color: theme.text, fontFamily: theme.font.semibold }}>
            Four ride commissions are unpaid. Pay your commission to accept
            another ride.
          </Text>
          <ToolButton
            label="Pay your commission"
            onPress={() => router.push("/earnings")}
          />
        </View>
      ) : null}
      {role && role !== "RIDER" && !temporarilySuspended ? (
        <ToolButton
          label={role === "VENDOR" ? "Create product" : "Upload"}
          onPress={() =>
            role==='TUTOR' ? router.push('/learning-publish' as '/agent-create') : router.push({ pathname: "/agent-create", params: { role } })
          }
        />
      ) : null}
      {role==='RIDER'?<Text style={{color:theme.textMuted,marginVertical:10}}>{online?'Online · available for deliveries':'Offline · go online from the rider options menu'}</Text>:null}
      {role === "RIDER" && (
        <View style={{ flexDirection: "row", gap: 12, marginVertical: 18 }}>
          {(["AVAILABLE", "ACTIVE", "HISTORY"] as const).map((tab) => (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: rideTab === tab }}
              onPress={() => setRideTab(tab)}
              style={{
                paddingVertical: 10,
                borderBottomWidth: 2,
                borderColor: tab === rideTab ? theme.brand : "transparent",
              }}
            >
              <Text
                style={{ fontFamily: theme.font.semibold, color: theme.text }}
              >
                {tab === "AVAILABLE"
                  ? "Available"
                  : tab === "ACTIVE"
                    ? "Your deliveries"
                    : "History"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {role==='RIDER'&&rideTab==='AVAILABLE'?items.filter(i=>i.status==='AVAILABLE').map(i=><ToolButton key={'route-'+i.id} secondary disabled={busy} label={`Review pickup route · ${i.vendor_name??i.pickup_location??i.zone_name??'Available ride'}`} onPress={()=>void reviewPickup(i)}/>):null}
      {profile&&!ready&&!loadError?<ScreenSkeleton variant="list" compact/>:null}
      {ready && !items.length && !loadError ? (
        <EmptyResult
          title={
            role === "RIDER"
              ? "No delivery requests"
              : role === "TUTOR"
                ? "No tutorials yet"
                : "No products yet"
          }
        />
      ) : null}
      {items
        .filter(
          (item) =>
            role !== "RIDER" ||
            (rideTab === "AVAILABLE"
              ? item.status === "AVAILABLE"
              : rideTab === "ACTIVE"
                ? ["RESERVED", "PICKED_UP"].includes(item.status)
                : !["AVAILABLE", "RESERVED", "PICKED_UP"].includes(
                    item.status,
                  )),
        )
        .map((item) => (
          <View
            key={(item.resource_type?'resource:':'listing:')+item.id}
            style={{
              paddingVertical: 18,
              borderBottomWidth: 1,
              borderColor: theme.border,
            }}
          >
            {role==='VENDOR'||role==='TUTOR'?<View style={{flexDirection:'row',alignItems:'center',gap:4}}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name??item.title??'listing'}`} disabled={Boolean(item.resource_type)&&!['PUBLISHED','DRAFT','REJECTED'].includes(item.status)} onPress={()=>openListing(item)} style={{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:2}}>
              {item.cover_url||item.image_urls?.[0]||item.image_url?<MediaImage uri={item.cover_url||item.image_urls?.[0]||item.image_url!} accessibilityLabel={`${item.name??item.title??'Listing'} cover photo`} resizeMode="cover" style={{width:72,height:72,borderRadius:12}}/>:
                <View accessibilityLabel={role==='VENDOR'?'No product photo':'No cover photo'} style={{width:72,height:72,borderRadius:12,backgroundColor:theme.surfaceMuted,alignItems:'center',justifyContent:'center'}}><Ionicons name={role==='VENDOR'?'image-outline':item.resource_type==='VIDEO'?'play-circle-outline':item.resource_type==='AUDIOBOOK'?'headset-outline':item.resource_type?'document-text-outline':'school-outline'} size={25} color={theme.textMuted}/></View>}
              <View style={{flex:1,minWidth:0,gap:6}}>
                <Text numberOfLines={2} style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:16}}>{item.name??item.title}</Text>
                <Text numberOfLines={1} style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:12}}>{item.status.replaceAll('_',' ').toLowerCase().replace(/^./,value=>value.toUpperCase())}{item.resource_type?' · '+(item.resource_type==='PAST_QUESTION'?'Past questions':item.resource_type==='AUDIOBOOK'?'Audiobook':item.resource_type==='NOTE'?'Notes':item.resource_type==='VIDEO'?'Video':item.resource_type):''}</Text>
                <Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand,fontSize:13}}>{item.access_model==='BOOKING_INCLUDED'?'Included with booking':role==='TUTOR'&&Number(item.price_kobo??0)===0?'Free':money(Number(item.price_kobo??0))}</Text>
              </View>
              </Pressable>
              <HeaderMenu label={`Options for ${item.name??item.title??'listing'}`} items={[
                {label:role==='VENDOR'?'Edit product':item.resource_type?'Edit material':'Edit tutorial',icon:'create-outline',disabled:busy||temporarilySuspended||!['DRAFT','REJECTED','PAUSED','PUBLISHED'].includes(item.status),onPress:()=>editListing(item)},
                ...(role==='TUTOR'&&!item.resource_type?[{label:'Manage sessions & bookings',icon:'calendar-outline' as const,onPress:()=>router.push({pathname:'/tutorial-manage',params:{id:item.id}})}]:[]),
                {label:role==='VENDOR'?'Delete product':item.resource_type?'Delete material':'Delete tutorial',icon:'trash-outline',destructive:true,disabled:busy||temporarilySuspended,onPress:()=>confirmDelete(item)},
              ]}/>
            </View>:<Text
              style={{
                fontFamily: theme.font.semibold,
                color: theme.text,
                fontSize: 17,
              }}
            >
              {item.vendor_name ??
                item.store_name ??
                item.name ??
                item.title ??
                item.zone_name}
            </Text>}
            {role === 'RIDER' && item.pickups?.map((stop,index)=><View key={index} style={{padding:14,gap:7,marginTop:10,borderWidth:1,borderColor:theme.border,borderRadius:12}}><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>{index+1}. {stop.vendor_name}</Text><Text style={{color:theme.textMuted}}>{stop.address}</Text>{stop.items?.map((line,n)=><Text key={n} style={{color:theme.text}}>{line.quantity} × {line.name}</Text>)}{stop.phone?<ToolButton secondary label="Call vendor" onPress={()=>void Linking.openURL('tel:'+stop.phone)}/>:null}{stop.whatsapp?<ToolButton secondary label="WhatsApp vendor" onPress={()=>void Linking.openURL('https://wa.me/'+stop.whatsapp!.replace(/\D/g,''))}/>:null}</View>)}
            {role === "RIDER" && (
              <View style={{ gap: 6, marginVertical: 8 }}>
                <Text style={{ color: theme.textMuted }}>
                  Pickup ·{" "}
                  {item.pickup_location || item.zone_name || "Campus store"}
                </Text>
                {item.delivery_note && (
                  <Text style={{ color: theme.text }}>
                    Delivery · {item.delivery_note}
                  </Text>
                )}
              </View>
            )}
            {role === "RIDER" && item.delivery_location ? (
              <Text style={{ color: theme.text, marginBottom: 12 }}>
                Drop-off · {item.delivery_location}
              </Text>
            ) : null}
            {role === "RIDER" &&
            ["RESERVED", "PICKED_UP"].includes(item.status) ? (
              <View style={{ gap: 8, marginVertical: 10 }}>
                {item.vendor_user_id ? (
                  <ToolButton
                    secondary
                    label="Message vendor"
                    disabled={busy}
                    onPress={() => {
                      void api<{ thread: { id: string } }>(
                        "/v1/messages/threads",
                        {
                          method: "POST",
                          body: JSON.stringify({ userId: item.vendor_user_id }),
                        },
                      )
                        .then((result) =>
                          router.push({
                            pathname: "/conversation",
                            params: { id: result.thread.id },
                          }),
                        )
                        .catch((e) =>
                          toast(
                            e instanceof Error
                              ? e.message
                              : "Messaging could not open.",
                            "error",
                          ),
                        );
                    }}
                  />
                ) : null}
                {item.vendor_phone ? (
                  <ToolButton
                    secondary
                    label="Call vendor"
                    onPress={() => {
                      void Linking.openURL(`tel:${item.vendor_phone}`).catch(
                        () => toast("Calling could not open.", "error"),
                      );
                    }}
                  />
                ) : null}
                {item.vendor_whatsapp ? (
                  <ToolButton
                    secondary
                    label="WhatsApp vendor"
                    onPress={() => {
                      void Linking.openURL(
                        `https://wa.me/${item.vendor_whatsapp!.replace(/\D/g, "")}`,
                      ).catch(() => toast("WhatsApp could not open.", "error"));
                    }}
                  />
                ) : null}
              </View>
            ) : null}
            {role==='RIDER'?<Text
              style={{
                fontFamily: theme.font.body,
                color: theme.textMuted,
                marginVertical: 8,
              }}
            >
              {item.status.replaceAll("_", " ")}
              {item.price_kobo !== undefined ||
              item.rider_earning_kobo !== undefined
                ? " · " +
                  money(Number(item.price_kobo ?? item.rider_earning_kobo ?? 0))
                : ""}
            </Text>:null}
            {role === "RIDER" && item.commission_kobo != null ? (
              <Text style={{ color: theme.textMuted }}>
                Fare {money(item.fare_kobo ?? 0)} ·{" "}
                {item.fare_payment_method === "CASH"
                  ? "Collect cash"
                  : "Paid in app"}{" "}
                · Commission {money(item.commission_kobo)} · You receive{" "}
                {money(item.rider_earning_kobo ?? 0)}
              </Text>
            ) : null}
            {role === "RIDER" && item.status === "AVAILABLE" ? (
              <ToolButton
                label="Accept delivery"
                disabled={busy || !online || ridesSuspended}
                onPress={() => void action(item, "reserve")}
              />
            ) : null}
            {role === "RIDER" &&
            ["RESERVED", "PICKED_UP"].includes(item.status) ? (
              <ToolButton
                secondary
                label={
                  item.status === "RESERVED"
                    ? "Confirm pickup"
                    : "Complete delivery"
                }
                disabled={busy}
                onPress={() => setSelected(item)}
              />
            ) : null}
          </View>
        ))}
      {selected ? (
        <View style={{ marginVertical: 20 }}>
          <ToolField
            label={
              selected.status === "RESERVED" ? "Pickup code" : "Delivery code"
            }
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <ToolButton
            label="Confirm"
            disabled={busy || code.length !== 6}
            onPress={() =>
              void action(
                selected,
                selected.status === "RESERVED" ? "pickup" : "complete",
              )
            }
          />
        </View>
      ) : null}
      </>}
    </ToolPage>
  );
}
