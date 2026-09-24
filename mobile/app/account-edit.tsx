import { useEffect, useState } from "react";
import { Image, View, Text, Switch } from "react-native";
import { router } from "expo-router";
import { ToolButton, ToolField, ToolPage } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { pickAndUpload } from "@/src/lib/uploads";
export default function EditProfile() {
  const { reloadProfile } = useAuth();
  const toast = useToast();
  const {theme}=useAppearance();
  const [publicRoles,setPublicRoles]=useState({vendor:true,tutor:true,rider:true});
  const [roles,setRoles]=useState<string[]>([]);
  const [rolesReady,setRolesReady]=useState(false);
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [username, setUsername] = useState("");
  const [biography, setBio] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active=true;
    void Promise.all([api<{settings:{publicRoles?:{vendor?:boolean;tutor?:boolean;rider?:boolean}}}>("/v1/account/settings"),api<{profiles:{agent_type:string}[]}>("/v1/account/capabilities")]).then(([s,c])=>{if(active){setPublicRoles({vendor:s.settings.publicRoles?.vendor!==false,tutor:s.settings.publicRoles?.tutor!==false,rider:s.settings.publicRoles?.rider!==false});setRoles(c.profiles.map(p=>p.agent_type.toLowerCase()));setRolesReady(true);}}).catch(()=>{if(active)toast("Role visibility settings could not load. Reopen this page before changing them.","error");});
    void api<{
      profile: {
        first_name: string;
        last_name: string;
        username: string;
        biography: string;
        profile_image_url: string;
        cover_image_url: string;
      };
    }>("/v1/student/me")
      .then(({ profile: p }) => {
        if(!active)return;
        setFirst(p.first_name ?? "");
        setLast(p.last_name ?? "");
        setUsername(p.username ?? "");
        setBio(p.biography ?? "");
        setPhoto(p.profile_image_url);
        setCover(p.cover_image_url);
        setReady(true);
      })
      .catch((e) => {if(active)toast(e.message, "error");});
    return()=>{active=false;};
  }, [toast]);
  async function upload(kind: "avatar" | "cover") {
    setBusy(true);
    try {
      const file = await pickAndUpload(kind);
      if (file) {
        if (kind === "avatar") setPhoto(file.url);
        else setCover(file.url);
        await reloadProfile();
        toast("Photo updated", "success");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api("/v1/account/profile", {
        method: "PATCH",
        body: JSON.stringify({ firstName, lastName, username, biography,...(rolesReady?{publicRoles}:{}) }),
      });
      await reloadProfile();
      toast("Profile saved", "success");
      router.back();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save profile", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title="Edit profile">
      {cover ? (
        <Image
          source={{ uri: cover }}
          style={{ height: 130, borderRadius: 18, marginBottom: 16 }}
        />
      ) : null}
      <View style={{ alignItems: "center", marginBottom: 18 }}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={{ width: 88, height: 88, borderRadius: 44 }}
          />
        ) : null}
      </View>
      <ToolButton
        label="Change profile photo"
        secondary
        disabled={busy}
        onPress={() => void upload("avatar")}
      />
      <ToolButton
        label="Change cover photo"
        secondary
        disabled={busy}
        onPress={() => void upload("cover")}
      />
      <View style={{ height: 18 }} />
      <ToolField
        label="First name"
        value={firstName}
        onChangeText={setFirst}
        maxLength={60}
      />
      <ToolField
        label="Last name"
        value={lastName}
        onChangeText={setLast}
        maxLength={60}
      />
      <ToolField
        label="Username"
        value={username}
        autoCapitalize="none"
        onChangeText={setUsername}
        maxLength={30}
      />
      <ToolField
        label="Bio"
        value={biography}
        onChangeText={setBio}
        maxLength={300}
        multiline
      />
      {rolesReady && roles.length ? <View style={{marginVertical:18,gap:12}}>
        <Text style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:16}}>Show on my profile</Text>
        <Text style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:12,lineHeight:18}}>Hide a role here without hiding your name on its storefront or service.</Text>
        {(["vendor","tutor","rider"] as const).filter(role=>roles.includes(role)).map(role=><View key={role} style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{fontFamily:theme.font.body,color:theme.text,textTransform:"capitalize"}}>{role}</Text><Switch accessibilityLabel={`Show ${role} on my public profile`} disabled={busy} value={publicRoles[role]} onValueChange={value=>setPublicRoles(previous=>({...previous,[role]:value}))}/></View>)}
      </View>:null}
      <ToolButton
        label={busy ? "Saving…" : "Save changes"}
        disabled={!ready || busy}
        onPress={() => void save()}
      />
    </ToolPage>
  );
}
