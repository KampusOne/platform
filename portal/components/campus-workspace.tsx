"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";

type Campus = {
  id: string;
  institution_id: string;
  latitude: string | number | null;
  longitude: string | number | null;
  name: string;
  slug: string;
  status: string;
};

type Place = {
  id: string;
  name: string;
  description: string;
  latitude: string | number | null;
  longitude: string | number | null;
  parent_place_id: string | null;
  floor_label: string;
  room_label: string;
  search_aliases: string[];
  status: string;
};

function textValue(values: FormData, key: string) {
  return String(values.get(key) ?? "").trim();
}

function numberOrNull(values: FormData, key: string) {
  const value = textValue(values, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CampusWorkspace() {
  const { scope, scopedPath, can } = useAdminContext();
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [editing, setEditing] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    void portalApi<{ campuses: Campus[] }>(scopedPath("/v1/campus-admin"))
      .then((response) => {
        if (!active) return;
        setCampuses(response.campuses);
        if (selectedId && !response.campuses.some((campus) => campus.id === selectedId)) {
          setSelectedId("");
          setPlaces([]);
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Campuses could not load.");
      });
    return () => {
      active = false;
    };
  }, [scopedPath, selectedId, version]);

  useEffect(() => {
    let active = true;
    if (selectedId) {
      void portalApi<{ places: Place[] }>(`/v1/campus-admin/${selectedId}/places`)
        .then((response) => {
          if (active) setPlaces(response.places);
        })
        .catch((caught) => {
          if (active) setError(caught instanceof Error ? caught.message : "Campus places could not load.");
        });
    }
    return () => {
      active = false;
    };
  }, [selectedId, version]);

  const current = useMemo(() => {
    const campus = campuses.find((item) => item.id === selectedId) ?? null;
    return campus && (!scope || campus.institution_id === scope) ? campus : null;
  }, [campuses, scope, selectedId]);

  async function saveCampus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = textValue(values, "name");
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/campus-admin", {
        method: "POST",
        body: JSON.stringify({
          universityId: scope,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          status: "DRAFT",
          latitude: null,
          longitude: null,
        }),
      });
      form.reset();
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campus could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCampusMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope || !current) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/campus-admin", {
        method: "POST",
        body: JSON.stringify({
          id: current.id,
          universityId: scope,
          name: current.name,
          slug: current.slug,
          status: textValue(values, "campusStatus"),
          latitude: numberOrNull(values, "campusLatitude"),
          longitude: numberOrNull(values, "campusLongitude"),
        }),
      });
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Campus map settings could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function savePlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/campus-admin/${current.id}/places`, {
        method: "POST",
        body: JSON.stringify({
          ...(editing ? { id: editing.id } : {}),
          name: textValue(values, "name"),
          description: textValue(values, "description"),
          parentId: textValue(values, "parent") || null,
          floor: textValue(values, "floor"),
          room: textValue(values, "room"),
          aliases: textValue(values, "aliases")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          latitude: numberOrNull(values, "latitude"),
          longitude: numberOrNull(values, "longitude"),
          status: textValue(values, "status"),
        }),
      });
      setEditing(null);
      form.reset();
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Place could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalShell
      active="admin"
      eyebrow="University places"
      title="Campuses & buildings"
      description="Keep each campus, building and office in its own university directory."
    >
      {error ? <p role="alert">{error}</p> : null}

      {can("universities.manage") ? (
        <form className="workspace-toolbar" onSubmit={saveCampus}>
          <label>
            New campus
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              disabled={busy || !scope}
              placeholder={scope ? "Campus name" : "Choose a university above"}
            />
          </label>
          <button className="button button--primary" disabled={busy || !scope}>
            Add campus
          </button>
        </form>
      ) : null}

      <div className="workspace-toolbar">
        {campuses.map((campus) => (
          <button
            key={campus.id}
            className={`button button--${current?.id === campus.id ? "primary" : "secondary"}`}
            onClick={() => {
              setSelectedId(campus.id);
              setEditing(null);
              setPlaces([]);
            }}
          >
            {campus.name} · {campus.status.toLowerCase()}
          </button>
        ))}
      </div>

      {!campuses.length ? <p>No campuses have been added in this scope.</p> : null}

      {current ? (
        <>
          <h2>{current.name}</h2>

          {can("universities.manage") ? (
            <form className="form-stack panel" onSubmit={saveCampusMap}>
              <h3>Campus map centre</h3>
              <p>
                Add one reviewed latitude/longitude pair for the campus. This gives the student map a reliable centre before individual buildings are added.
              </p>
              <label>
                Latitude
                <input
                  name="campusLatitude"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-90}
                  max={90}
                  defaultValue={current.latitude ?? ""}
                  placeholder="6.40079"
                />
              </label>
              <label>
                Longitude
                <input
                  name="campusLongitude"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-180}
                  max={180}
                  defaultValue={current.longitude ?? ""}
                  placeholder="5.61309"
                />
              </label>
              <label>
                Campus status
                <select name="campusStatus" defaultValue={current.status}>
                  <option>DRAFT</option>
                  <option>PUBLISHED</option>
                  <option>ARCHIVED</option>
                </select>
              </label>
              <div className="form-actions">
                <button className="button button--primary" disabled={busy}>
                  Save campus map settings
                </button>
              </div>
            </form>
          ) : null}

          <label>
            Find a building or office
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, room or alias"
            />
          </label>

          <div className="table-scroll">
            <table className="operational-table">
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Building</th>
                  <th>Floor / room</th>
                  <th>Coordinates</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {places
                  .filter((place) =>
                    [place.name, place.room_label, ...place.search_aliases]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((place) => (
                    <tr key={place.id}>
                      <td>{place.name}</td>
                      <td>
                        {places.find((building) => building.id === place.parent_place_id)?.name ??
                          "Building / place"}
                      </td>
                      <td>{[place.floor_label, place.room_label].filter(Boolean).join(" · ") || "—"}</td>
                      <td>
                        {place.latitude !== null && place.longitude !== null
                          ? `${place.latitude}, ${place.longitude}`
                          : "Not mapped"}
                      </td>
                      <td>{place.status}</td>
                      <td>
                        {can("universities.manage") ? (
                          <button onClick={() => setEditing(place)}>Edit</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {can("universities.manage") ? (
            <form className="form-stack panel" key={editing?.id ?? "new"} onSubmit={savePlace}>
              <h3>{editing ? "Edit place" : "Add building or office"}</h3>
              <label>
                Name
                <input required name="name" defaultValue={editing?.name} maxLength={180} />
              </label>
              <label>
                Inside building
                <select name="parent" defaultValue={editing?.parent_place_id ?? ""}>
                  <option value="">Standalone building / place</option>
                  {places
                    .filter((place) => !place.parent_place_id && place.id !== editing?.id)
                    .map((place) => (
                      <option key={place.id} value={place.id}>
                        {place.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Description
                <textarea name="description" defaultValue={editing?.description} maxLength={2000} />
              </label>
              <label>
                Latitude
                <input
                  name="latitude"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-90}
                  max={90}
                  defaultValue={editing?.latitude ?? ""}
                  placeholder="6.40079"
                />
              </label>
              <label>
                Longitude
                <input
                  name="longitude"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-180}
                  max={180}
                  defaultValue={editing?.longitude ?? ""}
                  placeholder="5.61309"
                />
              </label>
              <label>
                Floor
                <input name="floor" defaultValue={editing?.floor_label} maxLength={40} />
              </label>
              <label>
                Room
                <input name="room" defaultValue={editing?.room_label} maxLength={40} />
              </label>
              <label>
                Search names (comma separated)
                <input name="aliases" defaultValue={editing?.search_aliases.join(", ")} />
              </label>
              <label>
                Status
                <select name="status" defaultValue={editing?.status ?? "DRAFT"}>
                  <option>DRAFT</option>
                  <option>PUBLISHED</option>
                  <option>ARCHIVED</option>
                </select>
              </label>
              <p>
                A place appears as a map pin only when both coordinates are saved and its status is PUBLISHED.
              </p>
              <div className="form-actions">
                <button className="button button--primary" disabled={busy}>
                  Save place
                </button>
                {editing ? (
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </PortalShell>
  );
}
