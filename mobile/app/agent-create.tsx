import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { pickAndUpload } from "@/src/lib/uploads";
export default function CreateListing() {
  const { role } = useLocalSearchParams<{ role: string }>();
  const tutor = role === "TUTOR";
  const { theme } = useAppearance();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("1");
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [image, setImage] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!tutor)
      void api<{ categories: typeof categories }>(
        "/v1/agents/product-categories",
      )
        .then((r) => setCategories(r.categories))
        .catch((e) => toast(e.message, "error"));
  }, [tutor, toast]);
  async function upload() {
    setBusy(true);
    try {
      const file = await pickAndUpload("product");
      if (file) setImage(file.url);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const path = tutor ? "/v1/agents/tutorials" : "/v1/agents/products";
      const body = tutor
        ? {
            courseCode: code,
            title: name,
            description,
            format: "IN_PERSON",
            priceKobo: Math.round(Number(price) * 100),
            capacity: Number(stock),
            locationText: location,
          }
        : {
            name,
            description,
            category: categories.find((c) => c.id === category)?.name,
            categoryId: category,
            priceKobo: Math.round(Number(price) * 100),
            stockQuantity: Number(stock),
            imageUrl: image || null,
          };
      const created = await api<{ id: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await api(path + "/" + created.id + "/status", {
        method: "PATCH",
        body: JSON.stringify({ status: "SUBMITTED" }),
      });
      toast("Submitted for review", "success");
      router.back();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save listing", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToolPage title={tutor ? "Create tutorial" : "Add product"}>
      {!tutor ? (
        <>
          {image ? (
            <Image
              source={{ uri: image }}
              style={{ height: 200, borderRadius: 16, marginBottom: 18 }}
            />
          ) : null}
          <ToolButton
            secondary
            label="Choose product photo"
            disabled={busy}
            onPress={() => void upload()}
          />
        </>
      ) : null}
      <ToolField
        label={tutor ? "Tutorial title" : "Product name"}
        value={name}
        onChangeText={setName}
        maxLength={160}
      />
      <ToolField
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />
      <ToolField
        label="Price (₦)"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <ToolField
        label={tutor ? "Available places" : "Stock quantity"}
        value={stock}
        onChangeText={setStock}
        keyboardType="number-pad"
      />
      {tutor ? (
        <>
          <ToolField label="Course code" value={code} onChangeText={setCode} />
          <ToolField
            label="Location"
            value={location}
            onChangeText={setLocation}
          />
        </>
      ) : (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {categories.map((c) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: category === c.id }}
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
      )}
      <ToolButton
        label={busy ? "Saving…" : "Submit for review"}
        disabled={
          busy ||
          !name.trim() ||
          description.trim().length < 20 ||
          price === "" ||
          (!tutor && (!image || !category))
        }
        onPress={() => void save()}
      />
    </ToolPage>
  );
}
