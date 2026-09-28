import { InlineLoading } from "@/src/components/skeleton";
import { useCampusLocation } from "@/src/lib/campus-location";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "@/src/lib/haptics";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Image,
  Linking,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CampusMapDrawer } from "@/src/components/campus-map-drawer";
import { ApiError, api } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { theme } from "@/src/theme";

const categories = [
  "All",
  "Academic",
  "Service",
  "Transport",
  "Hostel",
  "Food",
  "Health",
  "Sport",
] as const;

const MIN_MAP_HEIGHT = 360;
const MIN_MAP_ZOOM = 0.85;
const MAX_MAP_ZOOM = 2.35;
const WALKING_METRES_PER_MINUTE = 75;
const CURRENT_LOCATION_ID = "__current_location__";
const MAX_LIVE_ROUTE_DISTANCE_METRES = 2500;

type IconName = keyof typeof Ionicons.glyphMap;
type Place = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  latitude: string | null;
  longitude: string | null;
  accessibility_notes: string | null;
  image_url: string | null;
  verified_at: string | null;
  search_aliases?: readonly string[] | null;
};
type MappedPlace = Place & { latitudeValue: number; longitudeValue: number };

const UNIBEN_UGBOWO_FALLBACK: Place[] = ([["5a3e978c-8d07-411c-bd0d-1b08313fe128","Student Affairs Division","SERVICE","Student Affairs Division, University of Benin Ugbowo Campus.","6.400023","5.609885",["Student Affairs","Dean of Students"],true],["280c87f4-139b-5504-ac0c-f910731ac64c","Main Gate","TRANSPORT","Primary Ugbowo campus entrance and student pickup landmark.","6.399920","5.608870",["UNIBEN Main Gate","Main Entrance"],true],["7a85539d-13df-5d11-8c95-4cc878ef0657","Main Gate Bus Terminal","TRANSPORT","Campus bus and shuttle pickup area near the Main Gate.","6.399050","5.609320",["Maingate Bus Terminal","Main Gate Bus Stop"],false],["dfb816ff-345c-5af0-80bc-0383f2c09fca","Maingate Shopping Complex","SERVICE","Student shopping and services complex near the Main Gate.","6.398288","5.610109",["Main Gate Shopping Complex","Maingate Shops"],true],["52ecce2e-8dac-5b0f-92d6-212536be74a6","Student Guidance and Counselling Centre","SERVICE","Student Guidance and Counselling Centre near the old bookshop and student halls.","6.396750","5.619180",["Guidance and Counselling","Counselling Centre"],false],["9f040cce-eb71-572a-8dd8-15cbe7799b19","Main Auditorium","SERVICE","University of Benin Main Auditorium.","6.399710","5.613300",["UNIBEN Main Auditorium","Auditorium"],true],["b446bddc-f6b7-5e4a-a6ef-6f96738a7759","Central Administration","SERVICE","Central administration area on Ugbowo Campus.","6.399450","5.612650",["Central Admin","Administration Block","Registry"],false],["2be8a76a-ef9f-5a69-a3cc-3abbd5803bae","Exams and Records","SERVICE","Examinations and records office area.","6.399000","5.612100",["Exams & Records","Records Office"],false],["63e1a25a-c6be-5386-b53d-aa4f0708db42","Bursary Department","SERVICE","University bursary and finance services.","6.398100","5.616850",["Bursary","UNIBEN Bursary"],false],["b22357c9-2fdd-51ea-8861-6fefa3fef4a0","University of Benin Microfinance Bank","SERVICE","University of Benin Microfinance Bank campus branch.","6.397760","5.617240",["UNIBEN Microfinance Bank","UNIBEN MFB"],false],["265d648c-28db-54b4-8eb8-68ddc10a4aef","Wema Bank - UNIBEN","SERVICE","Wema Bank branch on Ugbowo Campus.","6.400856","5.610236",["Wema Bank","Wema UNIBEN"],true],["c503e423-4b99-5e36-bf3c-dec9ca03406a","Guaranty Trust Bank - UNIBEN","SERVICE","Guaranty Trust Bank campus branch.","6.400863","5.610953",["GTBank","GTB UNIBEN","Guaranty Trust Bank"],true],["7fe547f4-1a71-53f0-b674-4c545b41d3c2","Stanbic IBTC Bank - UNIBEN","SERVICE","Stanbic IBTC branch on Ugbowo Campus.","6.400460","5.611460",["Stanbic IBTC","Stanbic UNIBEN"],false],["ed6428c9-1102-5cd6-9631-db9ec91dbc2e","Fidelity Bank - UNIBEN","SERVICE","Fidelity Bank branch on Ugbowo Campus.","6.400210","5.611780",["Fidelity Bank","Fidelity UNIBEN"],false],["84973da3-033f-5192-9bc6-f76ff76d428c","First Bank - UNIBEN","SERVICE","First Bank branch on Ugbowo Campus.","6.399980","5.611360",["First Bank","FirstBank UNIBEN"],false],["2ecc6e0e-ce20-5720-baea-d46173dd6a35","Zenith Bank - UNIBEN","SERVICE","Zenith Bank branch on Ugbowo Campus.","6.400720","5.611250",["Zenith Bank","Zenith UNIBEN"],false],["24387c80-2642-5a4c-b9d4-29006e7bf9e2","All Saints Chapel","SERVICE","Christian worship centre on Ugbowo Campus.","6.398900","5.611700",["All Saints Chapel UNIBEN"],false],["20be3e9f-67e0-5fe8-989e-4ef0f4ff197e","St. Albert Catholic Church","SERVICE","Catholic worship centre on Ugbowo Campus.","6.398520","5.612300",["Saint Albert Catholic Church","St Albert"],false],["c35d97e3-bed1-5643-8f3e-7f24fb879a2e","UNIBEN Mosque","SERVICE","Campus mosque near the student halls.","6.396900","5.619300",["Students Mosque","Mosque"],false],["a64fc253-2c9e-407c-b852-b077e0390d5b","Faculty of Engineering","ACADEMIC","Faculty of Engineering, University of Benin Ugbowo Campus.","6.401790","5.615370",["Engineering","Engr"],true],["3a19a50f-6dae-5f4e-a6fd-cac0d4df55e4","Department of Chemical Engineering","ACADEMIC","Department of Chemical Engineering in the Engineering cluster.","6.402250","5.615720",["Chemical Engineering","Chem Eng"],false],["e5b0f8af-acb2-505b-ac88-000ef4acc477","Mechanical Production Laboratory","ACADEMIC","Mechanical Production laboratory in the Engineering cluster.","6.402070","5.616080",["Mechanical Production Lab","Mechanical Lab"],false],["175bb188-292f-5058-9500-016f43014378","Engineering Old 1000 LT","ACADEMIC","Large lecture theatre in the Engineering area.","6.401350","5.614920",["Old 1000 LT","Engineering 1000 LT"],false],["4abd5761-6388-46f0-b20d-e3aef1f4f1c2","Faculty of Physical Sciences","ACADEMIC","Faculty of Physical Sciences, University of Benin Ugbowo Campus.","6.400310","5.615350",["Physical Science","Physical Sciences"],true],["71329ef0-fcc7-5931-96f9-bf100342a72e","1000 LT Faculty of Physical Sciences","ACADEMIC","Large lecture theatre serving Physical Sciences.","6.400720","5.617000",["Physical Science 1000 LT","1000LT"],false],["65fdfcdf-50c1-5f53-83ff-28d7558fc506","Computer Science Department","ACADEMIC","Computer Science Department, Ugbowo Campus.","6.401180","5.617220",["Computer Science","Computer Science Department UNIBEN"],false],["fe6bd15a-4934-59cd-9233-99fc40970a66","UNIBEN International ICT Centre","SERVICE","University ICT centre and digital services hub.","6.400938","5.616359",["ICT Centre","ICTU","CRPU","Iyayi Computer Building"],true],["f61bd3ec-dbdf-498d-aaab-c867c8c77522","Faculty of Life Sciences","ACADEMIC","Faculty of Life Sciences, University of Benin Ugbowo Campus.","6.398940","5.614870",["Life Science","Life Sciences"],true],["6a656590-974f-5ac8-ba5b-6a660e4ddf8d","Faculty of Life Sciences Dean's Office","ACADEMIC","Dean's Office for the Faculty of Life Sciences.","6.398620","5.615650",["Life Science Dean Office","Dean's Office Life Science"],false],["724a8afe-20bb-56ce-987c-191ec01a7f03","PBB and AEB Laboratories","ACADEMIC","Life Sciences PBB, MCB and AEB laboratory cluster.","6.398160","5.616000",["PBB Labs","AEB Labs","MCB","Faculty of Life Science Labs"],false],["5aeff0e1-9df2-5e13-8c3f-a3b5005a2c01","Department of Biochemistry","ACADEMIC","Department of Biochemistry, Ugbowo Campus.","6.396250","5.615050",["Biochemistry","Department of Biochemistry UNIBEN"],false],["eb15b248-b922-50a8-a532-4d734a480f2a","Physical Science Shopping Complex","SERVICE","Student food, stationery and everyday services near Physical Sciences.","6.399563","5.616578",["Physical Science Shops","Physical Science Shopping"],true],["34ae9089-799b-5cb9-8ddc-5026d572faea","Life Science Shopping Complex","SERVICE","Student shopping and food services near Life Sciences.","6.397238","5.615359",["Life Science Shops","Life Science Shopping"],true],["59368a84-86d1-5c4f-81a8-bdd6ef111e85","Basement Shopping Complex","SERVICE","Student shopping and service complex known as Basement.","6.396638","5.615109",["Basement","Students Complex"],true],["1a926f1d-222c-581a-80a0-b1d6042e4867","John Harris Library","ACADEMIC","Main academic library on Ugbowo Campus.","6.396660","5.616687",["JHL","Main Library","John Harris"],true],["3c9fcb8e-39ff-51f1-a796-07126e17decb","John Harris Library Extension","ACADEMIC","John Harris Library extension and e-learning spaces.","6.396930","5.616520",["Library Extension","Donald Partridge e-Learning Centre","MTNF e-Library"],false],["c1a6b966-0cec-427d-8672-fe1df10ae369","Faculty of Education","ACADEMIC","Faculty of Education, University of Benin Ugbowo Campus.","6.400910","5.619670",["Education"],true],["e2d8ea45-9bc9-5789-8133-1cb55893e588","UNIBEN Education Field","SPORT","Open sports and activity field near the Education and Engineering areas.","6.402480","5.618650",["Education Field","Faculty of Education Field"],false],["9ee9eac7-eeee-5da5-bc97-a0cb34f4b9b5","Faculty of Management Sciences","ACADEMIC","Faculty of Management Sciences building.","6.399200","5.618050",["Management Sciences","Management Science"],false],["e1ab63c1-5fbd-4a41-9a4d-f2c0b18d7fae","Faculty of Law","ACADEMIC","Faculty of Law, University of Benin Ugbowo Campus.","6.400530","5.622440",["Law"],true],["60cfd3e2-6db6-581a-9048-76b057103a11","Faculty of Arts","ACADEMIC","Faculty of Arts, University of Benin Ugbowo Campus.","6.403300","5.622170",["Arts","Faculty Arts"],true],["338d121f-da2a-5d76-8a41-fcd266804cb4","Old Faculty of Agriculture","ACADEMIC","Older Faculty of Agriculture building east of the Law area.","6.400500","5.623430",["Old Agric","Old Agriculture"],false],["d345d3fc-8c25-5a23-88d7-22b34b4d4376","New Faculty of Agriculture","ACADEMIC","New Faculty of Agriculture building.","6.403350","5.619650",["New Agric","Agriculture"],false],["25931066-ecde-5af0-89c0-ef9a84a30343","Faculty of Agriculture Shopping Mall","SERVICE","Student shopping area serving the Agriculture and Hall 4 axis.","6.399050","5.622850",["Agric Shopping Mall","Agriculture Shopping"],false],["c3928d61-f327-557e-a243-b5c3ae7bec19","Faculty of Environmental Sciences","ACADEMIC","Faculty of Environmental Sciences campus building.","6.402800","5.620650",["Environmental Science","Environmental Sciences"],false],["9ce6c230-f7c3-526b-adbe-e819e81ec85b","Centre for Entrepreneurship Development","ACADEMIC","University entrepreneurship teaching and development centre.","6.402080","5.621250",["Entrepreneurship Centre","CED"],false],["886362e8-0aae-5388-9579-d03a7d177a46","Petroleum and Energy Research Centre","ACADEMIC","Petroleum and energy research centre.","6.403050","5.620050",["Petroleum Research Centre","Energy Research Centre"],false],["680a996b-b27f-5bda-b76e-9ea577cf9022","Centre of Excellence in Geosciences and Petroleum Engineering","ACADEMIC","Geosciences and petroleum engineering centre.","6.401850","5.623500",["Centre of Excellence in Geosciences","Geosciences Centre"],false],["6ada12ab-8e39-5938-8a6c-83f4ba5083f5","Central Research Laboratory","ACADEMIC","University of Benin Central Research Laboratory.","6.403954","5.618651",["CRL","Central Research Lab"],true],["fb6d80b0-d0a7-5812-8790-0a1fb32ae423","University of Benin Staff School","ACADEMIC","University staff school on the Ugbowo campus axis.","6.404250","5.620350",["UNIBEN Staff School","Staff School"],false],["ab8fedb8-6f20-54fd-b543-22896f4e9d5b","University Demonstration Secondary School","ACADEMIC","University Demonstration Secondary School.","6.404050","5.617550",["UDSS","University Demonstration School"],false],["f66a29bf-08dc-43b6-be7a-d66c099613a5","JUPEB Foundation School","ACADEMIC","UNIBEN JUPEB Foundation School, Ugbowo Campus.","6.397003","5.617815",["JUPEB","Foundation School","JUPEB Building"],true],["f75b3456-471d-55c0-b64d-63b4a885086e","Festus Iyayi Hall","ACADEMIC","Large lecture and event hall in the central academic area.","6.398438","5.617391",["Festus Iyayi Hall","Iyayi Hall"],true],["eb6b62e3-7ccc-5739-a727-bddccc0f70df","Faculty of Pharmacy","ACADEMIC","Faculty of Pharmacy, Ugbowo Campus.","6.396050","5.620350",["Pharmacy","Faculty Pharmacy"],false],["bb931009-6d8b-5647-88ec-3603b720f8d9","Pharmacy Annex","ACADEMIC","Pharmacy teaching annex near the medical and hostel axis.","6.395700","5.620220",["Pharmacy Annex UNIBEN"],false],["fd9c8337-c8ce-593b-a3f0-616c261d5d32","Pharmacy Lecture Theatres","ACADEMIC","Lecture theatre cluster serving Pharmacy.","6.396180","5.619900",["Pharmacy LT","Pharmacy Lecture Theater"],false],["b6476973-c5db-5d17-9464-25dae56e6774","School of Dentistry","ACADEMIC","School of Dentistry, University of Benin.","6.396400","5.624700",["Dentistry","School Of Dentistry"],false],["7dddb9ff-df5d-5c1d-bd25-affb0df6ce11","Institute of Health Sciences and Technology","ACADEMIC","Health sciences and technology institute near the Main Gate axis.","6.397950","5.609050",["Institute of Health Sciences","Health Sciences and Technology"],false],["5c706c07-9258-54ed-ab6b-ca29736a398a","University of Benin Health Centre","HEALTH","University health centre with student medical services.","6.403100","5.623510",["Health Centre","Medical Centre"],true],["25f63f0f-4524-590c-9ac0-6fbe0b56a8ab","Medical Complex","HEALTH","Medical teaching and service complex on Ugbowo Campus.","6.395438","5.623172",["Medical Complex UNIBEN"],true],["dcf11440-5c29-5b36-a05f-e7125d77d228","UNIBEN Anatomy Back Gate","TRANSPORT","Pedestrian access point near Anatomy and the medical hostel axis.","6.396200","5.617800",["Anatomy Back Gate","Anatomy Gate"],false],["c3b9b0fc-00b8-537b-a417-a3989904a39e","Back Gate","TRANSPORT","Secondary campus access point on the eastern/southern campus edge.","6.395900","5.625200",["UNIBEN Back Gate"],false],["6a96705f-809a-5276-85c8-20a9483704c6","Ekosodin Gate Security Post","SERVICE","Security post at the Ekosodin-side campus access.","6.404500","5.624700",["Ekosodin Gate","Ekosodin Security Post"],false],["9ca0be2a-0ea6-5305-bebf-7b4315e6c1ad","Hall 1 Hostel","HOSTEL","Hall 1 (Queen Idia Hall), Ugbowo Campus.","6.396613","5.618672",["Hall 1","Queen Idia Hostel","Queen Idia Hall"],true],["1e1ddc99-6b48-585c-8df5-fe25b9177045","Hall 2 Hostel","HOSTEL","Hall 2 (Madam Tinubu Hall), Ugbowo Campus.","6.398438","5.619672",["Hall 2","Tinubu Female Hostel","Madam Tinubu Hall"],true],["95de09db-4898-589a-8496-4a3814294d66","Hall 3 Hostel","HOSTEL","Hall 3 (Mallam Aminu Kano Hall), Ugbowo Campus.","6.396913","5.619953",["Hall 3","Aminu Kano Hostel","Mallam Aminu Kano Hall"],true],["bc5f982b-7509-566e-b62f-29fc7362175c","Hall 4 Hostel","HOSTEL","Hall 4 (Akanu Ibiam Hall), Ugbowo Campus.","6.398300","5.622550",["Hall 4","Akanu Ibiam Hall"],false],["647a85ab-9396-45c4-b427-bebb7d3dcf3b","Hall 5 Hostel","HOSTEL","Hall 5 student hostel, University of Benin Ugbowo Campus.","6.397120","5.623920",["Hall 5"],true],["68a12e6f-640c-4412-8cf6-63a5502d454c","Hall 6 Hostel","HOSTEL","Hall 6 student hostel, University of Benin Ugbowo Campus.","6.398220","5.626190",["Hall 6"],true],["5931353c-3b42-4b13-a5f6-a48ff024c92d","Hall 7 Hostel","HOSTEL","Hall 7 postgraduate hostel, University of Benin Ugbowo Campus.","6.397970","5.625230",["Hall 7"],true],["99189c22-3c1b-4d07-baf5-81a1544aa283","Clinical Hostel","HOSTEL","Clinical students hostel, University of Benin Ugbowo Campus.","6.394530","5.617190",["Clinical Hall","Clinical Students Hostel"],true],["8918a6f0-c56a-432f-b8d1-0d6aed349b57","NDDC Hostel","HOSTEL","NDDC student hostel, University of Benin Ugbowo Campus.","6.394710","5.617890",["NDDC Hall"],true],["3b0c31b8-0be6-52b1-a8f1-426284503985","Medical Hostel","HOSTEL","Medical students hostel near the clinical and Anatomy axis.","6.396050","5.618950",["Medical Students Hostel","Medical Hall"],false],["c56d49e1-8bbb-54be-84e1-542ca9878e9f","Keystone Hostel","HOSTEL","Keystone student hostel, Ugbowo Campus.","6.398913","5.625328",["Keystone Hall"],true],["71afeb51-76f0-5b06-a38f-c79390432a78","Intercontinental Hostel","HOSTEL","Intercontinental postgraduate hostel, Ugbowo Campus.","6.398000","5.624400",["Intercontinental Hall","Intercontinental Bank PG Hall"],false],["427ff6b3-eaa0-54d9-b043-7658f5f3a00e","Erastus Akinbola Postgraduate Hostel","HOSTEL","Postgraduate residence hall on Ugbowo Campus.","6.397413","5.625328",["Akinbola Hostel","Festus Akingbola","Postgraduate Hostel"],true],["f9d9e845-ec23-4ef6-90da-aa84a651a5d6","Food Court (Buka)","FOOD","Campus food court (Buka), University of Benin Ugbowo Campus.","6.395260","5.619070",["Buka","Food Court"],true],["d5b2d262-6648-5253-93d8-989c2b0f759b","Helena Food","FOOD","Food spot near the student hostel and Buka axis.","6.395900","5.617600",["Helena Food UNIBEN"],false],["8269011d-9152-59a9-a527-97440fd51cb8","Mat-Ice Restaurant","FOOD","Restaurant near the medical and hostel axis.","6.395800","5.620300",["Mat Ice","Mat-Ice"],false],["637e5efe-cb1c-5826-9e46-f33bf805c87a","Swift Canteen","FOOD","Student canteen near Pharmacy and Buka.","6.395520","5.619800",["Swift Canteen UNIBEN"],false],["36196663-907e-50ec-83ef-eed7cdc307bd","CERHI Cafe","FOOD","Cafe near the health sciences area.","6.395650","5.620750",["CERHI Café","CERHI"],false],["95ea2f97-b0fb-5104-bec4-b942a477444e","Nescafe Lounge UNIBEN","FOOD","Cafe/lounge in the eastern academic area.","6.401431","5.621666",["Nescafe Lounge","Nescafe UNIBEN"],true],["7589297a-ce88-5d7d-b020-d60a9fff4fc9","Home & Away Restaurant Ugbowo","FOOD","Restaurant on the Ugbowo campus axis.","6.396013","5.614172",["Home and Away","Home & Away"],true],["31815e90-5b67-5589-9744-5fb5547481d4","UNIBEN Book Shop","SERVICE","University bookshop and student supplies.","6.402150","5.621350",["Bookshop","UNIBEN Bookshop"],false],["2ac78f1e-e237-50d1-aab3-0d7396e26833","June 12 Shopping Complex","SERVICE","Student shopping complex in the Law/Hall 4 axis.","6.398700","5.621300",["June 12","June 12 UNIBEN"],false],["3ffac6ab-3650-5d64-997a-c2864dfdf288","Hall 1 Bus Stop","TRANSPORT","Campus shuttle stop serving the student halls.","6.396900","5.618050",["Hall 1 Bus stop","Hall One Bus Stop"],false],["e547742a-868a-5349-81a2-f05a81ab06c8","Hall 1 Car Park","SERVICE","Car park serving Hall 1 and nearby facilities.","6.396350","5.618250",["Hall 1 Parking","Hall 1 Car Park"],false],["ca06a270-05c4-501e-959d-40532503699c","Medical Hostel Car Park","SERVICE","Parking area near Medical Hostel.","6.395820","5.618650",["Medical Hostel Parking"],false],["d9da568f-74da-5dd7-8d73-e63905878062","Alumni Car Park","SERVICE","Parking area near the library and hostel axis.","6.395950","5.617050",["Alumni Parking"],false],["bf0cc0d5-6a6e-52ce-bc46-2c87ed953c49","Biochemistry Parking Lot","SERVICE","Parking area near the Department of Biochemistry.","6.396100","5.615350",["Biochemistry Car Park","Biochemistry Parking"],false],["65f3124d-3690-50a6-a01e-1a7afe90eec5","UNIBEN Sports Complex","SPORT","University sports complex.","6.399763","5.613578",["Sports Complex","Stadium"],true],["2436a456-902d-57fb-8310-cf9b8f7d5946","Main Bowl","SPORT","Main sports bowl within the university sports complex.","6.399200","5.612950",["UNIBEN Main Bowl","Main Stadium Bowl"],false],["95d8aa69-b4a7-53cf-9861-cf7b12831249","UNIBEN Indoor Sports Hall","SPORT","Indoor sports facility on Ugbowo Campus.","6.398350","5.612750",["Indoor Sports Hall","Indoor Sport Hall"],false],["217ebcc6-f66f-51c5-a856-3271399d5549","UNIBEN Basketball Court","SPORT","Outdoor basketball court on Ugbowo Campus.","6.397690","5.610920",["Basketball Court","Basketball"],true],["d4b11b3d-dcdc-5f79-a742-97309f67fd59","Handball Court","SPORT","Outdoor handball court in the sports area.","6.397350","5.611150",["UNIBEN Handball Court"],false],["3be9b5a7-6f6d-55ae-8f84-e35daff58078","Lawn Tennis Court","SPORT","Lawn tennis court in the sports area.","6.397900","5.611650",["Tennis Court","UNIBEN Lawn Tennis"],false]] as Array<
  [string, string, string, string, string, string, string[], boolean]
>).map(([id, name, category, description, latitude, longitude, aliases, verified]) => ({
  id,
  name,
  category,
  description,
  latitude,
  longitude,
  accessibility_notes: null,
  image_url: null,
  search_aliases: aliases,
  verified_at: verified ? "2026-09-28T00:00:00.000Z" : null,
}));

type PixelPoint = { x: number; y: number };
type CampusEdge = { a: string; b: string; distance: number };
type CampusRoute = { distance: number; ids: string[] };
type Projection = {
  centerLatitude: number;
  centerLongitude: number;
  scale: number;
};

const icons: Record<string, IconName> = {
  ACADEMIC: "school-outline",
  FOOD: "restaurant-outline",
  HEALTH: "medkit-outline",
  HOSTEL: "bed-outline",
  SERVICE: "help-buoy-outline",
  SPORT: "football-outline",
  TRANSPORT: "bus-outline",
};

const markerColors: Record<string, string> = {
  ACADEMIC: "#526FA8",
  FOOD: "#B95D50",
  HEALTH: "#A8462E",
  HOSTEL: "#8D5535",
  SERVICE: "#7A6A5D",
  SPORT: "#4B7B54",
  TRANSPORT: "#3F6B78",
};

const zoneColors: Record<string, string> = {
  ACADEMIC: "rgba(82,111,168,.10)",
  FOOD: "rgba(185,93,80,.10)",
  HEALTH: "rgba(168,70,46,.10)",
  HOSTEL: "rgba(141,85,53,.11)",
  SERVICE: "rgba(122,106,93,.09)",
  SPORT: "rgba(75,123,84,.10)",
  TRANSPORT: "rgba(63,107,120,.09)",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coordinatesFor(place: Place) {
  if (
    place.latitude === null ||
    place.longitude === null ||
    !place.latitude.trim() ||
    !place.longitude.trim()
  ) {
    return null;
  }

  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function distanceBetween(a: MappedPlace, b: MappedPlace) {
  const earthRadius = 6371000;
  const latitudeA = (a.latitudeValue * Math.PI) / 180;
  const latitudeB = (b.latitudeValue * Math.PI) / 180;
  const latitudeDelta = ((b.latitudeValue - a.latitudeValue) * Math.PI) / 180;
  const longitudeDelta = ((b.longitudeValue - a.longitudeValue) * Math.PI) / 180;
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function campusEdges(places: MappedPlace[]): CampusEdge[] {
  const edges = new Map<string, CampusEdge>();

  for (const place of places) {
    const nearest = places
      .filter((candidate) => candidate.id !== place.id)
      .map((candidate) => ({
        candidate,
        distance: distanceBetween(place, candidate),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 3);

    for (const item of nearest) {
      const first = place.id < item.candidate.id ? place.id : item.candidate.id;
      const second = place.id < item.candidate.id ? item.candidate.id : place.id;
      const key = first + ":" + second;
      if (!edges.has(key)) {
        edges.set(key, {
          a: first,
          b: second,
          distance: item.distance,
        });
      }
    }
  }

  return Array.from(edges.values());
}

function shortestCampusRoute(
  places: MappedPlace[],
  edges: CampusEdge[],
  originId: string,
  destinationId: string,
): CampusRoute | null {
  if (!originId || !destinationId || originId === destinationId) return null;

  const placeIds = new Set(places.map((place) => place.id));
  if (!placeIds.has(originId) || !placeIds.has(destinationId)) return null;

  const adjacency = new Map<string, Array<{ id: string; distance: number }>>();
  for (const place of places) adjacency.set(place.id, []);
  for (const edge of edges) {
    adjacency.get(edge.a)?.push({ id: edge.b, distance: edge.distance });
    adjacency.get(edge.b)?.push({ id: edge.a, distance: edge.distance });
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const pending = new Set(placeIds);
  for (const id of placeIds) distances.set(id, Number.POSITIVE_INFINITY);
  distances.set(originId, 0);

  while (pending.size) {
    let current = "";
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const id of pending) {
      const distance = distances.get(id) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = id;
        currentDistance = distance;
      }
    }

    if (!current || !Number.isFinite(currentDistance)) break;
    pending.delete(current);
    if (current === destinationId) break;

    for (const neighbour of adjacency.get(current) ?? []) {
      if (!pending.has(neighbour.id)) continue;
      const nextDistance = currentDistance + neighbour.distance;
      if (nextDistance < (distances.get(neighbour.id) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbour.id, nextDistance);
        previous.set(neighbour.id, current);
      }
    }
  }

  const total = distances.get(destinationId);
  if (!Number.isFinite(total)) return null;

  const ids = [destinationId];
  let current = destinationId;
  while (current !== originId) {
    const previousId = previous.get(current);
    if (!previousId) return null;
    ids.unshift(previousId);
    current = previousId;
  }

  return { distance: total ?? 0, ids };
}

function createProjection(
  places: MappedPlace[],
  width: number,
  height: number,
  zoom: number,
): Projection | null {
  if (!places.length || width <= 0 || height <= 0) return null;

  let minimumLatitude = places[0]?.latitudeValue ?? 0;
  let maximumLatitude = minimumLatitude;
  let minimumLongitude = places[0]?.longitudeValue ?? 0;
  let maximumLongitude = minimumLongitude;

  for (const place of places) {
    minimumLatitude = Math.min(minimumLatitude, place.latitudeValue);
    maximumLatitude = Math.max(maximumLatitude, place.latitudeValue);
    minimumLongitude = Math.min(minimumLongitude, place.longitudeValue);
    maximumLongitude = Math.max(maximumLongitude, place.longitudeValue);
  }

  const latitudeSpan = Math.max(maximumLatitude - minimumLatitude, 0.0025);
  const longitudeSpan = Math.max(maximumLongitude - minimumLongitude, 0.0025);
  const usableWidth = Math.max(180, width - 76);
  const usableHeight = Math.max(180, height - 126);
  const scale = Math.min(
    usableWidth / longitudeSpan,
    usableHeight / latitudeSpan,
  );

  return {
    centerLatitude: (minimumLatitude + maximumLatitude) / 2,
    centerLongitude: (minimumLongitude + maximumLongitude) / 2,
    scale: scale * zoom,
  };
}

function pointFor(
  place: MappedPlace,
  projection: Projection,
  width: number,
  height: number,
  pan: PixelPoint,
): PixelPoint {
  return {
    x:
      width / 2 +
      (place.longitudeValue - projection.centerLongitude) * projection.scale +
      pan.x,
    y:
      height / 2 -
      (place.latitudeValue - projection.centerLatitude) * projection.scale +
      pan.y,
  };
}

function routeEdgeKeys(route: CampusRoute | null) {
  const keys = new Set<string>();
  if (!route) return keys;

  for (let index = 1; index < route.ids.length; index += 1) {
    const a = route.ids[index - 1] ?? "";
    const b = route.ids[index] ?? "";
    keys.add(a < b ? a + ":" + b : b + ":" + a);
  }

  return keys;
}

function formatDistance(metres: number) {
  if (metres < 1000) return Math.max(1, Math.round(metres)) + " m";
  return (metres / 1000).toFixed(metres >= 10000 ? 0 : 1) + " km";
}

function VerificationBadge() {
  const { theme, styles } = useThemeStyles(createStyles);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.verifiedBadge}
    >
      <Ionicons color={theme.verificationMark} name="checkmark" size={9} />
    </View>
  );
}

function MapSegment({
  active,
  from,
  to,
}: {
  active: boolean;
  from: PixelPoint;
  to: PixelPoint;
}) {
  const { styles } = useThemeStyles(createStyles);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  if (length < 1) return null;

  const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
  return (
    <View
      pointerEvents="none"
      style={[
        active ? styles.routeSegment : styles.walkwaySegment,
        {
          left: (from.x + to.x) / 2 - length / 2,
          top: (from.y + to.y) / 2 - (active ? 3 : 2),
          width: length,
          transform: [{ rotate: angle + "deg" }],
        },
      ]}
    />
  );
}

function CampusMap({
  choosingOrigin,
  currentLocation,
  destination,
  directoryError,
  directoryLoading,
  height,
  onLayout,
  onRequestCurrentLocation,
  onSelect,
  origin,
  places,
  route,
  routePlaces,
  selected,
  visiblePlaceIds,
  width,
}: {
  choosingOrigin: boolean;
  currentLocation: MappedPlace | undefined;
  destination: MappedPlace | undefined;
  directoryError: boolean;
  directoryLoading: boolean;
  height: number;
  onLayout: (event: LayoutChangeEvent) => void;
  onRequestCurrentLocation: () => void;
  onSelect: (id: string) => void;
  origin: MappedPlace | undefined;
  places: MappedPlace[];
  route: CampusRoute | null;
  routePlaces: MappedPlace[];
  selected: MappedPlace | undefined;
  visiblePlaceIds: Set<string>;
  width: number;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PixelPoint>({ x: 0, y: 0 });
  const panRef = useRef<PixelPoint>(pan);
  const dragStartRef = useRef<PixelPoint>({ x: 0, y: 0 });
  const canPanRef = useRef(false);

  const boundsKey = useMemo(
    () => places.map((place) => place.id).sort().join("|"),
    [places],
  );
  const projection = useMemo(
    () => createProjection(places, width, height, zoom),
    [height, places, width, zoom],
  );
  const edges = useMemo(() => campusEdges(places), [places]);
  const routePlaceById = useMemo(
    () => new Map(routePlaces.map((place) => [place.id, place] as const)),
    [routePlaces],
  );
  const pendingLocationCenterRef = useRef(false);

  useEffect(() => {
    const centered = { x: 0, y: 0 };
    panRef.current = centered;
    setPan(centered);
    setZoom(1);
  }, [boundsKey]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  canPanRef.current = projection !== null;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          canPanRef.current &&
          (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4),
        onPanResponderGrant: () => {
          dragStartRef.current = panRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          setPan({
            x: dragStartRef.current.x + gesture.dx,
            y: dragStartRef.current.y + gesture.dy,
          });
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [],
  );

  const points = useMemo(() => {
    const result = new Map<string, PixelPoint>();
    if (!projection) return result;
    for (const place of places) {
      result.set(place.id, pointFor(place, projection, width, height, pan));
    }
    return result;
  }, [height, pan, places, projection, width]);

  const categoryZones = useMemo(() => {
    const groups = new Map<string, PixelPoint[]>();
    for (const place of places) {
      const point = points.get(place.id);
      if (!point) continue;
      const group = groups.get(place.category) ?? [];
      group.push(point);
      groups.set(place.category, group);
    }

    return Array.from(groups.entries())
      .filter(([, group]) => group.length >= 2)
      .map(([category, group]) => {
        const x = group.reduce((sum, point) => sum + point.x, 0) / group.length;
        const y = group.reduce((sum, point) => sum + point.y, 0) / group.length;
        return { category, x, y };
      });
  }, [places, points]);

  const centerOnCurrentLocation = useCallback(() => {
    if (!projection || !currentLocation) return false;
    const point = pointFor(
      currentLocation,
      projection,
      width,
      height,
      { x: 0, y: 0 },
    );
    const centered = {
      x: width / 2 - point.x,
      y: height / 2 - point.y,
    };
    panRef.current = centered;
    setPan(centered);
    return true;
  }, [currentLocation, height, projection, width]);

  useEffect(() => {
    if (!pendingLocationCenterRef.current || !currentLocation) return;
    if (centerOnCurrentLocation()) {
      pendingLocationCenterRef.current = false;
    }
  }, [centerOnCurrentLocation, currentLocation]);

  const recenter = useCallback(() => {
    void Haptics.selectionAsync();
    if (centerOnCurrentLocation()) return;
    pendingLocationCenterRef.current = true;
    onRequestCurrentLocation();
  }, [centerOnCurrentLocation, onRequestCurrentLocation]);

  const canZoomIn = zoom < MAX_MAP_ZOOM;
  const canZoomOut = zoom > MIN_MAP_ZOOM;

  return (
    <View style={styles.mapFrame}>
      <View
        {...panResponder.panHandlers}
        onLayout={onLayout}
        style={[styles.mapViewport, { height }]}
      >
        <View pointerEvents="none" style={styles.campusBoundary} />

        {categoryZones.map((zone) => (
          <View
            key={zone.category}
            pointerEvents="none"
            style={[
              styles.zone,
              {
                backgroundColor: zoneColors[zone.category] ?? "rgba(168,70,46,.07)",
                left: zone.x - 72,
                top: zone.y - 50,
              },
            ]}
          >
            <Text style={styles.zoneLabel}>
              {zone.category.charAt(0) + zone.category.slice(1).toLowerCase()}
            </Text>
          </View>
        ))}

        {projection
          ? edges.map((edge) => {
              const from = points.get(edge.a);
              const to = points.get(edge.b);
              if (!from || !to) return null;
              const key = edge.a < edge.b ? edge.a + ":" + edge.b : edge.b + ":" + edge.a;
              return (
                <MapSegment
                  active={false}
                  from={from}
                  key={key}
                  to={to}
                />
              );
            })
          : null}

        {projection && route
          ? route.ids.slice(1).map((toId, index) => {
              const fromId = route.ids[index];
              if (!fromId || !toId) return null;
              const fromPlace = routePlaceById.get(fromId);
              const toPlace = routePlaceById.get(toId);
              if (!fromPlace || !toPlace) return null;
              return (
                <MapSegment
                  active
                  from={pointFor(fromPlace, projection, width, height, pan)}
                  key={"route:" + fromId + ":" + toId}
                  to={pointFor(toPlace, projection, width, height, pan)}
                />
              );
            })
          : null}

        {projection && currentLocation ? (
          (() => {
            const position = pointFor(
              currentLocation,
              projection,
              width,
              height,
              pan,
            );
            if (
              position.x < -60 ||
              position.x > width + 60 ||
              position.y < -60 ||
              position.y > height + 60
            ) {
              return null;
            }
            return (
              <View
                accessibilityLabel="Your current location"
                pointerEvents="none"
                style={[
                  styles.currentLocationMarker,
                  { left: position.x, top: position.y },
                ]}
              >
                <View style={styles.currentLocationPulse} />
                <View style={styles.currentLocationDot} />
              </View>
            );
          })()
        ) : null}

        {projection
          ? places.map((place) => {
              const position = points.get(place.id);
              if (!position) return null;
              if (
                position.x < -40 ||
                position.x > width + 40 ||
                position.y < -40 ||
                position.y > height + 40
              ) {
                return null;
              }

              const isOrigin = place.id === origin?.id;
              const isDestination = place.id === destination?.id;
              const isSelected = place.id === selected?.id;
              const isVisible =
                visiblePlaceIds.has(place.id) ||
                choosingOrigin ||
                Boolean(route) ||
                isOrigin ||
                isDestination;

              return (
                <Pressable
                  accessibilityLabel={
                    place.name +
                    ", " +
                    place.category.toLowerCase() +
                    (place.verified_at ? ", verified campus place" : "")
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  hitSlop={5}
                  key={place.id}
                  onPress={() => onSelect(place.id)}
                  style={({ pressed }) => [
                    styles.pin,
                    {
                      backgroundColor:
                        markerColors[place.category] ?? theme.brand,
                      left: position.x,
                      opacity: isVisible ? 1 : 0.24,
                      top: position.y,
                    },
                    (isSelected || isOrigin || isDestination) && styles.pinActive,
                    isOrigin && styles.pinOrigin,
                    isDestination && styles.pinDestination,
                    pressed && styles.pinPressed,
                  ]}
                >
                  <Ionicons
                    color="#FFFFFF"
                    name={
                      isOrigin
                        ? "walk"
                        : isDestination
                          ? "flag"
                          : icons[place.category] ?? "location-outline"
                    }
                    size={isSelected || isOrigin || isDestination ? 17 : 14}
                  />
                </Pressable>
              );
            })
          : null}

        <View pointerEvents="none" style={styles.layerBadge}>
          <View style={styles.layerBadgeIcon}>
            <Ionicons color="#FFFFFF" name="map" size={13} />
          </View>
          <View>
            <Text style={styles.layerBadgeTitle}>KampusOne map</Text>
            <Text style={styles.layerBadgeMeta}>OSM-linked campus data</Text>
          </View>
        </View>

        <View style={styles.mapControls}>
          <Pressable
            accessibilityLabel="Zoom in"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canZoomIn }}
            disabled={!canZoomIn}
            onPress={() => {
              void Haptics.selectionAsync();
              setZoom((current) => clamp(current + 0.2, MIN_MAP_ZOOM, MAX_MAP_ZOOM));
            }}
            style={({ pressed }) => [
              styles.zoomButton,
              !canZoomIn && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons color={theme.text} name="add" size={20} />
          </Pressable>
          <View style={styles.controlDivider} />
          <Pressable
            accessibilityLabel="Zoom out"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canZoomOut }}
            disabled={!canZoomOut}
            onPress={() => {
              void Haptics.selectionAsync();
              setZoom((current) => clamp(current - 0.2, MIN_MAP_ZOOM, MAX_MAP_ZOOM));
            }}
            style={({ pressed }) => [
              styles.zoomButton,
              !canZoomOut && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons color={theme.text} name="remove" size={20} />
          </Pressable>
          <View style={styles.controlDivider} />
          <Pressable
            accessibilityLabel="Center map on current location"
            accessibilityRole="button"
            accessibilityState={{ disabled: !projection }}
            disabled={!projection}
            onPress={recenter}
            style={({ pressed }) => [
              styles.zoomButton,
              !projection && styles.controlDisabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons color={theme.text} name="locate-outline" size={18} />
          </Pressable>
        </View>

        {!projection && directoryLoading ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <InlineLoading color={theme.brand} />
            <Text style={styles.mapFeedbackTitle}>Loading campus map…</Text>
          </View>
        ) : null}

        {!projection && directoryError ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <Ionicons
              color={theme.accentText}
              name="cloud-offline-outline"
              size={24}
            />
            <Text style={styles.mapFeedbackTitle}>Campus map unavailable</Text>
            <Text style={styles.mapFeedbackText}>
              Retry below to load the campus directory.
            </Text>
          </View>
        ) : null}

        {!projection && !directoryLoading && !directoryError ? (
          <View pointerEvents="none" style={styles.mapFeedback}>
            <Ionicons color={theme.textMuted} name="map-outline" size={26} />
            <Text style={styles.mapFeedbackTitle}>No mapped places yet</Text>
          </View>
        ) : null}

      </View>
    </View>
  );
}

function PlaceRow({
  onDirections,
  onSelect,
  place,
  selected,
}: {
  onDirections: (place: Place) => void;
  onSelect: (id: string) => void;
  place: Place;
  selected: boolean;
}) {
  const { theme, styles } = useThemeStyles(createStyles);
  const hasCoordinates = coordinatesFor(place) !== null;

  return (
    <View style={[styles.placeRow, selected && styles.placeRowSelected]}>
      <Pressable
        accessibilityLabel={"Show " + place.name + " on campus map"}
        accessibilityRole="button"
        onPress={() => onSelect(place.id)}
        style={({ pressed }) => [
          styles.placeMain,
          pressed && styles.placeMainPressed,
        ]}
      >
        {place.image_url ? (
          <Image
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            resizeMode="cover"
            source={{ uri: place.image_url }}
            style={styles.placeImage}
          />
        ) : (
          <View style={styles.placeIcon}>
            <Ionicons
              color={theme.brandPressed}
              name={icons[place.category] ?? "location-outline"}
              size={21}
            />
          </View>
        )}
        <View style={styles.placeCopy}>
          <View style={styles.placeCategoryRow}>
            <Text style={styles.placeCategory}>
              {place.category.toLowerCase()}
            </Text>
            {place.verified_at ? <VerificationBadge /> : null}
          </View>
          <Text numberOfLines={1} style={styles.placeName}>
            {place.name}
          </Text>
          <Text numberOfLines={2} style={styles.placeDescription}>
            {place.description ??
              "Campus information will be added by a verified editor."}
          </Text>
          {place.accessibility_notes ? (
            <View style={styles.accessibilityRow}>
              <Ionicons
                color={theme.info}
                name="accessibility-outline"
                size={13}
              />
              <Text numberOfLines={1} style={styles.accessibilityText}>
                {place.accessibility_notes}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={
          hasCoordinates
            ? "Directions to " + place.name
            : "Directions unavailable for " + place.name
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: !hasCoordinates }}
        disabled={!hasCoordinates}
        onPress={() => onDirections(place)}
        style={({ pressed }) => [
          styles.rowDirection,
          !hasCoordinates && styles.rowDirectionDisabled,
          pressed && styles.controlPressed,
        ]}
      >
        <Ionicons
          color={hasCoordinates ? "#FFFFFF" : theme.textSubtle}
          name={hasCoordinates ? "navigate" : "location-outline"}
          size={17}
        />
      </Pressable>
    </View>
  );
}

export default function MapScreen() {
  const { theme, styles } = useThemeStyles(createStyles);
  const { profile } = useAuth();
  const campusLocation = useCampusLocation();
  const { height } = useWindowDimensions();
  const mapHeight = Math.max(MIN_MAP_HEIGHT, height);

  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<(typeof categories)[number]>("All");
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mapWidth, setMapWidth] = useState(360);
  const [routeDestinationId, setRouteDestinationId] = useState("");
  const [routeOriginId, setRouteOriginId] = useState("");
  const [choosingOrigin, setChoosingOrigin] = useState(false);

  const load = useCallback(async () => {
    const isUniben =
      profile?.university_name?.trim().toLowerCase() === "university of benin";
    try {
      setError("");
      const response = await api<{ places: Place[] }>("/v1/student/campus/places");
      if (response.places.length || !isUniben) {
        setPlaces(response.places);
      } else {
        setPlaces(UNIBEN_UGBOWO_FALLBACK);
      }
    } catch (caught) {
      if (isUniben) {
        setPlaces(UNIBEN_UGBOWO_FALLBACK);
        setError("");
      } else {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Campus places could not be loaded.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [profile?.university_name]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filtered = useMemo(
    () =>
      places.filter((place) => {
        const needle = query.trim().toLowerCase();
        return (
          (selectedCategory === "All" ||
            place.category.toUpperCase() === selectedCategory.toUpperCase()) &&
          (!needle ||
            (
              place.name +
              " " +
              (place.description ?? "") +
              " " +
              (place.search_aliases?.join(" ") ?? "")
            )
              .toLowerCase()
              .includes(needle))
        );
      }),
    [places, query, selectedCategory],
  );

  const allMappedPlaces = useMemo<MappedPlace[]>(
    () =>
      places.flatMap((place) => {
        const coordinates = coordinatesFor(place);
        if (!coordinates) return [];
        return [
          {
            ...place,
            latitudeValue: coordinates.latitude,
            longitudeValue: coordinates.longitude,
          },
        ];
      }),
    [places],
  );

  const mappedPlaces = useMemo<MappedPlace[]>(
    () =>
      filtered.flatMap((place) => {
        const coordinates = coordinatesFor(place);
        if (!coordinates) return [];
        return [
          {
            ...place,
            latitudeValue: coordinates.latitude,
            longitudeValue: coordinates.longitude,
          },
        ];
      }),
    [filtered],
  );

  const currentLocationPlace = useMemo<MappedPlace | undefined>(() => {
    if (!campusLocation.position) return undefined;
    return {
      id: CURRENT_LOCATION_ID,
      name: "Current location",
      category: "TRANSPORT",
      description: "Live device location",
      latitude: String(campusLocation.position.latitude),
      longitude: String(campusLocation.position.longitude),
      accessibility_notes: null,
      image_url: null,
      verified_at: null,
      search_aliases: ["My location", "Current position"],
      latitudeValue: campusLocation.position.latitude,
      longitudeValue: campusLocation.position.longitude,
    };
  }, [campusLocation.position]);

  const currentLocationDistance = useMemo(() => {
    if (!currentLocationPlace || !allMappedPlaces.length) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.min(
      ...allMappedPlaces.map((place) =>
        distanceBetween(currentLocationPlace, place),
      ),
    );
  }, [allMappedPlaces, currentLocationPlace]);

  const liveLocationRouteEligible =
    Boolean(currentLocationPlace) &&
    currentLocationDistance <= MAX_LIVE_ROUTE_DISTANCE_METRES;

  const routingPlaces = useMemo(
    () =>
      currentLocationPlace && liveLocationRouteEligible
        ? [...allMappedPlaces, currentLocationPlace]
        : allMappedPlaces,
    [allMappedPlaces, currentLocationPlace, liveLocationRouteEligible],
  );

  const visiblePlaceIds = useMemo(
    () => new Set(mappedPlaces.map((place) => place.id)),
    [mappedPlaces],
  );
  const selectedPlace = allMappedPlaces.find(
    (place) => place.id === selectedPlaceId,
  );
  const routeOrigin = routingPlaces.find(
    (place) => place.id === routeOriginId,
  );
  const routeDestination = allMappedPlaces.find(
    (place) => place.id === routeDestinationId,
  );
  const graphEdges = useMemo(
    () => campusEdges(routingPlaces),
    [routingPlaces],
  );
  const route = useMemo(
    () =>
      shortestCampusRoute(
        routingPlaces,
        graphEdges,
        routeOriginId,
        routeDestinationId,
      ),
    [graphEdges, routeDestinationId, routeOriginId, routingPlaces],
  );

  const clearRoute = useCallback(() => {
    void Haptics.selectionAsync();
    setSelectedPlaceId("");
    setRouteOriginId("");
    setRouteDestinationId("");
    setChoosingOrigin(false);
    setQuery("");
    setNotice("");
  }, []);

  const requestCurrentLocation = useCallback(async () => {
    if (
      campusLocation.permission === "denied" &&
      !campusLocation.canAskAgain
    ) {
      setNotice("Enable location for KampusOne in your phone settings.");
      await Linking.openSettings();
      return null;
    }

    const position = await campusLocation.requestLocation();
    if (!position && campusLocation.error) {
      setNotice(campusLocation.error);
    }
    return position;
  }, [
    campusLocation.canAskAgain,
    campusLocation.error,
    campusLocation.permission,
    campusLocation.requestLocation,
  ]);

  const useCurrentLocationAsOrigin = useCallback(async () => {
    let position = campusLocation.position;
    if (!position) {
      position = await requestCurrentLocation();
    } else if (campusLocation.error && campusLocation.servicesEnabled) {
      position = await campusLocation.retryLocation();
    }

    if (!position) return;

    const livePlace: MappedPlace = {
      id: CURRENT_LOCATION_ID,
      name: "Current location",
      category: "TRANSPORT",
      description: "Live device location",
      latitude: String(position.latitude),
      longitude: String(position.longitude),
      accessibility_notes: null,
      image_url: null,
      verified_at: null,
      latitudeValue: position.latitude,
      longitudeValue: position.longitude,
    };

    const nearestDistance = allMappedPlaces.length
      ? Math.min(
          ...allMappedPlaces.map((place) => distanceBetween(livePlace, place)),
        )
      : Number.POSITIVE_INFINITY;

    if (nearestDistance > MAX_LIVE_ROUTE_DISTANCE_METRES) {
      const message =
        "Your current location is outside the mapped campus area. Choose a campus starting point instead.";
      setNotice(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }

    setRouteOriginId(CURRENT_LOCATION_ID);
    setChoosingOrigin(false);
    setQuery("");
    setNotice("");
    AccessibilityInfo.announceForAccessibility(
      "Using your live current location as the route start.",
    );
  }, [
    allMappedPlaces,
    campusLocation.error,
    campusLocation.position,
    campusLocation.retryLocation,
    campusLocation.servicesEnabled,
    requestCurrentLocation,
  ]);

  const beginDirections = useCallback((place: Place) => {
    if (!coordinatesFor(place)) {
      const message =
        "Directions are unavailable until this place has mapped coordinates.";
      setNotice(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }

    void Haptics.selectionAsync();
    setSelectedPlaceId(place.id);
    setRouteDestinationId(place.id);
    setRouteOriginId("");
    setChoosingOrigin(true);
    setQuery("");
    setNotice("");
    AccessibilityInfo.announceForAccessibility(
      "Choose your starting point on the campus map.",
    );
  }, []);

  const selectPlace = useCallback(
    (id: string) => {
      void Haptics.selectionAsync();

      if (choosingOrigin) {
        if (id === routeDestinationId) {
          const message = "Choose a different starting point.";
          setNotice(message);
          AccessibilityInfo.announceForAccessibility(message);
          return;
        }
        setRouteOriginId(id);
        setChoosingOrigin(false);
        setQuery("");
        setNotice("");
        AccessibilityInfo.announceForAccessibility(
          "Campus directions are ready.",
        );
        return;
      }

      const place = places.find((item) => item.id === id);
      if (place) {
        beginDirections(place);
      } else {
        setSelectedPlaceId(id);
      }
    },
    [beginDirections, choosingOrigin, places, routeDestinationId],
  );

  const updateMapLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setMapWidth((current) =>
      Math.abs(current - nextWidth) > 1 ? nextWidth : current,
    );
  }, []);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.mapScreen}>
        <CampusMap
          choosingOrigin={choosingOrigin}
          currentLocation={currentLocationPlace}
          destination={routeDestination}
          directoryError={Boolean(error) && !places.length}
          directoryLoading={loading}
          height={mapHeight}
          onLayout={updateMapLayout}
          onRequestCurrentLocation={() => {
            void requestCurrentLocation();
          }}
          onSelect={selectPlace}
          origin={routeOrigin}
          places={allMappedPlaces}
          route={route}
          routePlaces={routingPlaces}
          selected={selectedPlace}
          visiblePlaceIds={visiblePlaceIds}
          width={mapWidth}
        />

        {notice ? (
          <View style={styles.floatingNotice}>
            <Ionicons
              accessible={false}
              color={theme.accentText}
              name="information-circle-outline"
              size={18}
            />
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              numberOfLines={2}
              style={styles.floatingNoticeText}
            >
              {notice}
            </Text>
            <Pressable
              accessibilityLabel="Dismiss map notice"
              accessibilityRole="button"
              onPress={() => setNotice("")}
              style={({ pressed }) => [
                styles.noticeDismiss,
                pressed && styles.controlPressed,
              ]}
            >
              <Ionicons color={theme.textSubtle} name="close" size={19} />
            </Pressable>
          </View>
        ) : null}

        <CampusMapDrawer
          choosingOrigin={choosingOrigin}
          destinationName={routeDestination?.name ?? ""}
          error={error}
          loading={loading}
          locationAccuracy={campusLocation.position?.accuracy ?? null}
          locationError={campusLocation.error}
          locationLoading={campusLocation.loading}
          locationPermission={campusLocation.permission}
          onClearRoute={clearRoute}
          onPickDestination={(id) => {
            const place = places.find((item) => item.id === id);
            if (place) beginDirections(place);
          }}
          onPickOrigin={selectPlace}
          onQueryChange={setQuery}
          onUseCurrentLocation={() => {
            void useCurrentLocationAsOrigin();
          }}
          places={places}
          query={query}
          route={
            route && routeOrigin && routeDestination
              ? {
                  destinationName: routeDestination.name,
                  distanceMetres: route.distance,
                  originName: routeOrigin.name,
                }
              : null
          }
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { backgroundColor: theme.canvas, flex: 1, overflow: "hidden" },
    mapScreen: {
      flex: 1,
      overflow: "hidden",
      position: "relative",
    },
    floatingNotice: {
      alignItems: "center",
      backgroundColor: theme.surfaceRaised,
      borderColor: theme.border,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: "row",
      gap: 8,
      left: 14,
      minHeight: 52,
      paddingLeft: 12,
      paddingRight: 4,
      position: "absolute",
      right: 14,
      top: 12,
      ...theme.shadow,
    },
    floatingNoticeText: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 11.5,
      lineHeight: 17,
    },
    directory: { alignSelf: "center" },
    listContent: { paddingBottom: 120, paddingHorizontal: 18, paddingTop: 10 },
    header: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 16,
      paddingHorizontal: 2,
    },
    eyebrow: {
      color: theme.brandPressed,
      fontFamily: theme.font.bold,
      fontSize: 9,
      letterSpacing: 1.1,
    },
    title: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 26,
      lineHeight: 31,
      marginTop: 2,
    },
    headerIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 18,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    filters: { marginBottom: 14, marginTop: 12 },
    notice: {
      alignItems: "center",
      backgroundColor: "rgba(241,223,200,.50)",
      borderColor: "rgba(168,70,46,.14)",
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 8,
      marginBottom: 12,
      minHeight: 52,
      paddingLeft: 12,
      paddingRight: 4,
      paddingVertical: 4,
    },
    noticeText: {
      color: theme.text,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 11.5,
      lineHeight: 17,
    },
    noticeDismiss: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    mapFrame: {
      backgroundColor: theme.surfaceRaised,
      borderRadius: 0,
      borderWidth: 0,
      overflow: "hidden",
    },
    mapViewport: {
      backgroundColor: "#F2E9DC",
      overflow: "hidden",
      position: "relative",
      width: "100%",
    },
    campusBoundary: {
      backgroundColor: "rgba(255,255,255,.42)",
      borderColor: "rgba(168,70,46,.18)",
      borderRadius: 34,
      borderWidth: 2,
      bottom: 22,
      left: 18,
      position: "absolute",
      right: 18,
      top: 22,
    },
    zone: {
      alignItems: "center",
      borderRadius: 42,
      height: 100,
      justifyContent: "flex-start",
      paddingTop: 10,
      position: "absolute",
      width: 144,
    },
    zoneLabel: {
      color: "rgba(66,54,46,.47)",
      fontFamily: theme.font.bold,
      fontSize: 8,
      letterSpacing: 0.55,
      textTransform: "uppercase",
    },
    walkwaySegment: {
      backgroundColor: "rgba(97,83,73,.26)",
      borderRadius: 2,
      height: 4,
      position: "absolute",
    },
    routeSegment: {
      backgroundColor: theme.deepBrand,
      borderColor: "rgba(255,255,255,.90)",
      borderRadius: 3,
      borderWidth: 1,
      height: 6,
      position: "absolute",
    },
    layerBadge: {
      alignItems: "center",
      backgroundColor: "rgba(255,252,248,.94)",
      borderColor: "rgba(120,86,66,.16)",
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 8,
      left: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      position: "absolute",
      top: 10,
      ...theme.shadow,
    },
    layerBadgeIcon: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 10,
      height: 27,
      justifyContent: "center",
      width: 27,
    },
    layerBadgeTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 10.5,
    },
    layerBadgeMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 8.5,
      marginTop: 1,
    },
    mapControls: {
      backgroundColor: "rgba(255,252,248,.95)",
      borderColor: "rgba(120,86,66,.16)",
      borderRadius: 15,
      borderWidth: 1,
      overflow: "hidden",
      position: "absolute",
      right: 10,
      top: 68,
      ...theme.shadow,
    },
    zoomButton: {
      alignItems: "center",
      height: 38,
      justifyContent: "center",
      width: 38,
    },
    controlDivider: {
      backgroundColor: "rgba(120,86,66,.12)",
      height: 1,
      marginHorizontal: 8,
    },
    controlDisabled: { opacity: 0.35 },
    controlPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
    mapFeedback: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: "rgba(255,252,248,.94)",
      borderColor: "rgba(120,86,66,.16)",
      borderRadius: 18,
      borderWidth: 1,
      gap: 7,
      left: 48,
      padding: 16,
      position: "absolute",
      right: 48,
      top: 142,
      ...theme.shadow,
    },
    mapFeedbackTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
      textAlign: "center",
    },
    mapFeedbackText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 10.5,
      lineHeight: 15,
      textAlign: "center",
    },
    pin: {
      alignItems: "center",
      borderColor: "#FFFFFF",
      borderRadius: 17,
      borderWidth: 2,
      height: 34,
      justifyContent: "center",
      marginLeft: -17,
      marginTop: -17,
      position: "absolute",
      width: 34,
      ...theme.shadow,
    },
    pinActive: {
      borderRadius: 20,
      borderWidth: 3,
      height: 40,
      marginLeft: -20,
      marginTop: -20,
      width: 40,
    },
    pinOrigin: { borderColor: "#F6C453" },
    pinDestination: { borderColor: theme.deepBrand },
    pinPressed: { opacity: 0.82, transform: [{ scale: 0.95 }] },
    currentLocationMarker: {
      alignItems: "center",
      height: 48,
      justifyContent: "center",
      marginLeft: -24,
      marginTop: -24,
      position: "absolute",
      width: 48,
      zIndex: 20,
    },
    currentLocationPulse: {
      backgroundColor: "rgba(47,124,246,.20)",
      borderRadius: 24,
      height: 48,
      position: "absolute",
      width: 48,
    },
    currentLocationDot: {
      backgroundColor: "#2F7CF6",
      borderColor: "#FFFFFF",
      borderRadius: 10,
      borderWidth: 3,
      height: 20,
      width: 20,
      ...theme.shadow,
    },
    routePrompt: {
      alignItems: "center",
      backgroundColor: "rgba(255,252,248,.97)",
      borderColor: "rgba(168,70,46,.18)",
      borderRadius: 18,
      borderWidth: 1,
      bottom: 12,
      flexDirection: "row",
      gap: 9,
      left: 12,
      padding: 10,
      position: "absolute",
      right: 12,
      ...theme.shadow,
    },
    routePromptIcon: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 13,
      height: 38,
      justifyContent: "center",
      width: 38,
    },
    routePromptCopy: { flex: 1 },
    routePromptTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
    },
    routePromptText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 9.5,
      marginTop: 2,
    },
    routeClose: {
      alignItems: "center",
      borderRadius: 12,
      height: 38,
      justifyContent: "center",
      width: 38,
    },
    routeSummary: {
      backgroundColor: "rgba(255,252,248,.97)",
      borderColor: "rgba(168,70,46,.18)",
      borderRadius: 18,
      borderWidth: 1,
      bottom: 12,
      left: 12,
      padding: 11,
      position: "absolute",
      right: 12,
      ...theme.shadow,
    },
    routeSummaryTop: { alignItems: "center", flexDirection: "row" },
    routeSummaryCopy: { flex: 1, paddingRight: 8 },
    routeSummaryTitle: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 11.5,
    },
    routeSummaryMeta: {
      color: theme.brandPressed,
      fontFamily: theme.font.semibold,
      fontSize: 9.5,
      marginTop: 3,
    },
    routeLegend: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      marginTop: 8,
    },
    routeLegendLine: {
      backgroundColor: theme.deepBrand,
      borderRadius: 2,
      height: 4,
      width: 28,
    },
    routeLegendText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 8.5,
    },
    selectedPlace: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 72,
      paddingHorizontal: 11,
      paddingVertical: 10,
    },
    selectedPlaceIcon: {
      alignItems: "center",
      borderRadius: 13,
      height: 42,
      justifyContent: "center",
      width: 42,
    },
    selectedPlaceCopy: { flex: 1, marginLeft: 9 },
    selectedPlaceNameRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
    },
    selectedPlaceName: {
      color: theme.text,
      flexShrink: 1,
      fontFamily: theme.font.semibold,
      fontSize: 12.5,
    },
    selectedPlaceMeta: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 9.5,
      marginTop: 2,
    },
    mapDirection: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    mapCaption: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      minHeight: 56,
      paddingHorizontal: 12,
    },
    mapCaptionText: {
      color: theme.textMuted,
      flex: 1,
      fontFamily: theme.font.body,
      fontSize: 10,
      lineHeight: 15,
    },
    verifiedBadge: {
      alignItems: "center",
      backgroundColor: theme.brand,
      borderRadius: 7,
      height: 14,
      justifyContent: "center",
      width: 14,
    },
    directoryLoading: { alignItems: "center", gap: 8, paddingVertical: 24 },
    directoryLoadingText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
    },
    error: {
      alignItems: "center",
      backgroundColor: theme.surfaceSoft,
      borderRadius: 18,
      flexDirection: "row",
      gap: 11,
      marginTop: 14,
      minHeight: 72,
      padding: 14,
    },
    errorCopy: { flex: 1 },
    errorTitle: {
      color: theme.accentText,
      fontFamily: theme.font.semibold,
      fontSize: 13,
    },
    errorText: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: 2,
    },
    sectionHeader: {
      alignItems: "flex-end",
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 24,
      paddingHorizontal: 2,
    },
    sectionTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 22,
    },
    sectionSubtitle: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 11,
      marginTop: 3,
    },
    coordinateKey: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
      paddingBottom: 3,
    },
    coordinateKeyLine: {
      backgroundColor: theme.deepBrand,
      borderRadius: 2,
      height: 4,
      width: 20,
    },
    coordinateKeyText: {
      color: theme.brandPressed,
      fontFamily: theme.font.medium,
      fontSize: 9.5,
    },
    placeRow: {
      alignItems: "center",
      borderBottomColor: theme.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      minHeight: 106,
      paddingVertical: 10,
    },
    placeRowSelected: {
      backgroundColor: "rgba(241,223,200,.20)",
      borderRadius: 16,
      paddingHorizontal: 6,
    },
    placeMain: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      minHeight: 82,
    },
    placeMainPressed: { opacity: 0.76 },
    placeImage: { borderRadius: 15, height: 66, width: 66 },
    placeIcon: {
      alignItems: "center",
      backgroundColor: theme.surfaceMuted,
      borderRadius: 15,
      height: 62,
      justifyContent: "center",
      width: 62,
    },
    placeCopy: { flex: 1, marginLeft: 11 },
    placeCategoryRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
    },
    placeCategory: {
      color: theme.brandPressed,
      fontFamily: theme.font.bold,
      fontSize: 8.5,
      letterSpacing: 0.55,
      textTransform: "uppercase",
    },
    placeName: {
      color: theme.text,
      fontFamily: theme.font.semibold,
      fontSize: 14.5,
      marginTop: 3,
    },
    placeDescription: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 10.5,
      lineHeight: 15,
      marginTop: 2,
    },
    accessibilityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      marginTop: 4,
    },
    accessibilityText: {
      color: theme.info,
      flex: 1,
      fontFamily: theme.font.medium,
      fontSize: 9.5,
    },
    rowDirection: {
      alignItems: "center",
      backgroundColor: theme.deepBrand,
      borderRadius: 14,
      height: 44,
      justifyContent: "center",
      marginLeft: 8,
      width: 44,
    },
    rowDirectionDisabled: {
      backgroundColor: theme.surfaceMuted,
      opacity: 0.52,
    },
    directoryEmpty: {
      alignItems: "center",
      minHeight: 220,
      paddingHorizontal: 24,
      paddingTop: 48,
    },
    directoryEmptyTitle: {
      color: theme.text,
      fontFamily: theme.font.display,
      fontSize: 19,
      marginTop: 10,
    },
    directoryEmptyBody: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 12.5,
      lineHeight: 19,
      marginTop: 5,
      textAlign: "center",
    },
  });

const styles = createStyles(theme);
