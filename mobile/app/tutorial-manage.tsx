import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Text, View, Pressable } from "react-native";
import {
  ToolPage,
  ToolRow,
  ToolField,
  ToolButton,
} from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { pickLearningResource } from "@/src/lib/learning-resource-upload";
import { type UploadedFile } from "@/src/lib/uploads";
import {useAuth} from '@/src/auth/auth-context';
import {nairaToKobo} from '@/src/lib/money-input';
type Listing = {
  id: string;
  title: string;
  course_code: string;
  status: string;
  capacity: number;
};
type Booking = {
  id: string;
  listing_id: string;
  student_name: string;
  status: string;
  scheduled_for: string;
  completion_available: boolean;
  tutor_confirmed_at: string | null;
};
type Window = {
  id: string;
  listing_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  bookings: number;
};
type Resource = {
  id: string;
  listing_id: string;
  title: string;
  status: string;
};
export default function TutorialManagement() {
  const {user}=useAuth();
  const [uploadProgress,setUploadProgress]=useState<number|null>(null);
  const { id } = useLocalSearchParams<{ id: string }>(),
    toast = useToast(),
    { theme } = useAppearance();
  const [listing, setListing] = useState<Listing | null>(null),
    [bookings, setBookings] = useState<Booking[]>([]),
    [windows, setWindows] = useState<Window[]>([]),
    [resources, setResources] = useState<Resource[]>([]);
  const [tab, setTab] = useState<"Schedule" | "Bookings" | "Materials">(
      "Schedule",
    ),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [date, setDate] = useState(""),
    [start, setStart] = useState("09:00"),
    [end, setEnd] = useState("10:00");
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [file, setFile] = useState<UploadedFile | null>(null),
    [resourceType, setResourceType] = useState<
      "PDF" | "NOTE" | "PAST_QUESTION" | "AUDIOBOOK" | "VIDEO"
    >("PDF");
  const [accessModel,setAccessModel]=useState<"FREE"|"BOOKING_INCLUDED"|"PAID">("BOOKING_INCLUDED");
  const [resourcePrice,setResourcePrice]=useState("");
  const [durationMinutes,setDurationMinutes]=useState("");
  const load = useCallback(async () => {
    const [r, w] = await Promise.all([
      api<{ listings: Listing[]; bookings: Booking[]; resources: Resource[] }>(
        "/v1/agents/tutorials",
      ),
      api<{ windows: Window[] }>("/v1/agents/tutorial-availability"),
    ]);
    setListing(r.listings.find((l) => l.id === id) ?? null);
    setBookings(r.bookings.filter((b) => b.listing_id === id));
    setResources(r.resources.filter((r) => r.listing_id === id));
    setWindows(w.windows.filter((w) => w.listing_id === id));
    setReady(true);
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void load().catch((e) => toast(e.message, "error"));
    }, [load, toast]),
  );
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    try {
      await operation();
      await load();
      toast("Changes saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save changes", "error");
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    setBusy(true);
    try {
      if(!user)throw new Error('Sign in before uploading a tutorial.');
      setUploadProgress(0);
      const next = await pickLearningResource(resourceType,user.id,setUploadProgress);
      if (next) setFile(next);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }
  return (
    <ToolPage title={listing?.title ?? "Manage tutorial"}>
      {uploadProgress!==null?<View style={{backgroundColor:theme.surfaceMuted,padding:16,borderRadius:14,gap:10}}><Text style={{color:theme.text}}>Uploading · {Math.round(uploadProgress*100)}%</Text><View style={{height:5,backgroundColor:theme.border,borderRadius:3}}><View style={{height:5,width:`${Math.round(uploadProgress*100)}%`,backgroundColor:theme.brand,borderRadius:3}}/></View></View>:null}
      <ToolButton secondary label="Learners & product sales" onPress={()=>router.push("/tutor-learners")}/>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
        {(["Schedule", "Bookings", "Materials"] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            style={{
              padding: 12,
              borderBottomWidth: 2,
              borderColor: tab === t ? theme.brand : "transparent",
            }}
          >
            <Text
              style={{ color: theme.text, fontFamily: theme.font.semibold }}
            >
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
      {!ready ? (
        <ToolButton
          secondary
          label="Refresh"
          onPress={() => void load().catch((e) => toast(e.message, "error"))}
        />
      ) : !listing ? (
        <EmptyResult title="Tutorial unavailable" />
      ) : null}
      {listing && tab === "Schedule" ? (
        <>
          <ToolRow
            title="Publication"
            detail={listing.status.replaceAll("_", " ")}
          />
          {listing.status === "PUBLISHED" ? (
            <>
              <ToolField
                label="Date (YYYY-MM-DD)"
                value={date}
                onChangeText={setDate}
              />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <ToolField
                    label="Start (24-hour)"
                    value={start}
                    onChangeText={setStart}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ToolField
                    label="End (24-hour)"
                    value={end}
                    onChangeText={setEnd}
                  />
                </View>
              </View>
              <ToolButton
                label="Add session"
                disabled={busy || !date}
                onPress={() =>
                  void perform(async () => {
                    if (
                      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
                      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)
                    )
                      throw new Error("Check the date and times.");
                    const begins = new Date(`${date}T${start}:00`),
                      ends = new Date(`${date}T${end}:00`);
                    if (!Number.isFinite(begins.getTime()) || ends <= begins)
                      throw new Error("Check the session times.");
                    await api("/v1/agents/tutorial-availability", {
                      method: "POST",
                      body: JSON.stringify({
                        listingId: id,
                        startsAt: begins.toISOString(),
                        endsAt: ends.toISOString(),
                        capacity: listing.capacity,
                      }),
                    });
                    setDate("");
                  })
                }
              />
            </>
          ) : null}
          {windows.map((w) => (
            <ToolRow
              key={w.id}
              title={new Date(w.starts_at).toLocaleString()}
              detail={`${w.bookings} / ${w.capacity} booked`}
            />
          ))}
          {!windows.length ? <EmptyResult title="No sessions yet" /> : null}
          {["DRAFT", "REJECTED", "PAUSED"].includes(listing.status) ? (
            <ToolButton
              secondary
              label="Submit for review"
              disabled={busy}
              onPress={() =>
                void perform(() =>
                  api(`/v1/agents/tutorials/${id}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "SUBMITTED" }),
                  }),
                )
              }
            />
          ) : listing.status === "PUBLISHED" ? (
            <ToolButton
              secondary
              label="Pause new bookings"
              disabled={busy}
              onPress={() =>
                void perform(() =>
                  api(`/v1/agents/tutorials/${id}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "PAUSED" }),
                  }),
                )
              }
            />
          ) : null}
        </>
      ) : null}
      {listing && tab === "Bookings" ? (
        <>
          {bookings.map((b) => (
            <View key={b.id}>
              <ToolRow
                title={b.student_name}
                detail={`${b.status.replaceAll("_", " ")} · ${new Date(b.scheduled_for).toLocaleString()}`}
              />
              {b.completion_available &&
              b.status === "CONFIRMED" &&
              !b.tutor_confirmed_at ? (
                <ToolButton
                  label="Confirm session completed"
                  disabled={busy}
                  onPress={() =>
                    void perform(() =>
                      api(`/v1/agents/tutorial-bookings/${b.id}/confirm`, {
                        method: "POST",
                        body: JSON.stringify({ confirmed: true }),
                      }),
                    )
                  }
                />
              ) : null}
            </View>
          ))}
          {!bookings.length ? <EmptyResult title="No bookings yet" /> : null}
        </>
      ) : null}
      {listing && tab === "Materials" ? (
        <>
          <ToolField
            label="Material title"
            value={title}
            onChangeText={setTitle}
            maxLength={180}
          />
          <ToolField
            label="Description"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={2000}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(["PDF", "NOTE", "PAST_QUESTION", "AUDIOBOOK", "VIDEO"] as const).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="radio"
                accessibilityState={{ checked: resourceType === t }}
                onPress={() => { setResourceType(t); setFile(null); }}
                style={{
                  padding: 12,
                  backgroundColor:
                    resourceType === t ? theme.surfaceMuted : "transparent",
                  borderRadius: 10,
                }}
              >
                <Text
                  style={{ color: theme.text, fontFamily: theme.font.medium }}
                >
                  {t === "PAST_QUESTION"
                    ? "Past question"
                    : t === "NOTE"
                      ? "Notes"
                      : t === "AUDIOBOOK" ? "Audiobook" : t === "VIDEO" ? "Video" : "PDF"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginVertical:14}}>{(["FREE","BOOKING_INCLUDED","PAID"] as const).map(model=><Pressable key={model} accessibilityRole="radio" accessibilityState={{checked:accessModel===model}} onPress={()=>setAccessModel(model)} style={{padding:12,borderRadius:10,backgroundColor:accessModel===model?theme.surfaceMuted:"transparent"}}><Text style={{color:theme.text}}>{model==="FREE"?"Free":model==="PAID"?"Paid":"For booked students"}</Text></Pressable>)}</View>
          {accessModel==="PAID"&&<ToolField label="Price (₦)" value={resourcePrice} onChangeText={setResourcePrice} keyboardType="decimal-pad"/>}
          {["AUDIOBOOK","VIDEO"].includes(resourceType)&&<ToolField label="Duration (minutes)" value={durationMinutes} onChangeText={setDurationMinutes} keyboardType="decimal-pad"/>}
          {file&&<Text style={{color:theme.textMuted,marginVertical:10}}>File uploaded privately. Submit below to send it for review.</Text>}
          <ToolButton
            secondary
            label={file ? "Replace uploaded file" : "Choose file from device"}
            disabled={busy}
            onPress={() => void upload()}
          />
          <ToolButton
            label="Submit material"
            disabled={
              busy || !file || !title.trim() || description.trim().length < 10 || (accessModel === "PAID" && (!Number.isFinite(Number(resourcePrice)) || Number(resourcePrice) <= 0)) || (["AUDIOBOOK","VIDEO"].includes(resourceType) && (!Number.isFinite(Number(durationMinutes)) || Number(durationMinutes) <= 0))
            }
            onPress={() =>
              void perform(async () => {
                const r = await api<{ id: string }>(
                  "/v1/agents/tutorial-resources",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      listingId: id,
                      mediaId: file!.id,
                      courseCode: listing.course_code,
                      title,
                      description,
                      resourceType,
                      accessModel,
                      priceKobo: accessModel === "PAID" ? nairaToKobo(resourcePrice) : 0,
                      ...(["AUDIOBOOK","VIDEO"].includes(resourceType) ? {durationSeconds:Math.round(Number(durationMinutes)*60)} : {}),
                    }),
                  },
                );
                await api(`/v1/agents/tutorial-resources/${r.id}/status`, {
                  method: "PATCH",
                  body: JSON.stringify({ status: "SUBMITTED" }),
                });
                setTitle("");
                setDescription("");
                setFile(null);
              })
            }
          />
          {resources.map((r) => (
            <ToolRow
              key={r.id}
              title={r.title}
              detail={r.status.replaceAll("_", " ")}
            />
          ))}
        </>
      ) : null}
    </ToolPage>
  );
}
