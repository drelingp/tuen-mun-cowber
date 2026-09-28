'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Polyline, TileLayer } from 'leaflet'

export type MapPoint = {
  lat: number
  lng: number
}

export type RouteData = {
  coords: Array<[number, number]>
  km: number
  min: number
  mode: 'route' | 'estimate'
}

type FocusTarget = {
  point: MapPoint
  zoom?: number
} | null

type MoooberMapProps = {
  start: MapPoint | null
  end: MapPoint | null
  route: RouteData | null
  approachRoute: Array<[number, number]> | null
  driverPosition: MapPoint | null
  dark: boolean
  focusTarget: FocusTarget
  recenterToken: number
  pickMode: 'start' | 'end' | null
  onMapClick: (point: MapPoint) => void
  onTileSourceChange?: (sourceName: string) => void
}

type TileSource = {
  name: string
  url: string
  attribution: string
  subdomains?: string[]
}

const CENTER: [number, number] = [22.421, 113.985]
let leaflet: typeof import('leaflet') | null = null

const TILE_SOURCES: TileSource[] = [
  {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: ['a', 'b', 'c'],
  },
  {
    name: 'Esri World Street Map',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, OpenStreetMap contributors',
  },
  {
    name: 'OpenStreetMap DE',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
]

const AMBIENT_TRACKS: Array<Array<[number, number]>> = [
  [
    [22.382, 113.949],
    [22.395, 113.968],
    [22.406, 113.99],
    [22.414, 114.012],
  ],
  [
    [22.438, 113.985],
    [22.447, 114.004],
    [22.456, 114.027],
    [22.465, 114.047],
  ],
  [
    [22.429, 114.062],
    [22.445, 114.044],
    [22.46, 114.026],
    [22.476, 114.012],
  ],
  [
    [22.369, 113.966],
    [22.386, 113.978],
    [22.402, 113.982],
    [22.419, 113.979],
  ],
  [
    [22.417, 113.94],
    [22.43, 113.958],
    [22.444, 113.978],
    [22.455, 114.0],
  ],
  [
    [22.449, 114.02],
    [22.448, 114.038],
    [22.444, 114.056],
    [22.434, 114.071],
  ],
]

function createPinIcon(kind: 'start' | 'end' | 'driver') {
  const className = kind === 'start' ? 'mooober-pin mooober-pin--start' : kind === 'end' ? 'mooober-pin mooober-pin--end' : 'mooober-driver-pin'
  const content = kind === 'driver'
    ? '<span class="mooober-cow-emoji mooober-cow-emoji--driver" aria-hidden="true">🐄</span>'
    : '<i></i>'
  const size = kind === 'driver' ? 44 : 28

  return leaflet!.divIcon({
    className: '',
    html: `<div class="${className}">${content}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function createAmbientIcon(index: number) {
  return leaflet!.divIcon({
    className: '',
    html: `<div class="mooober-ambient-cow" style="--cow-delay:${index * 0.22}s"><span class="mooober-cow-emoji mooober-cow-emoji--ambient" aria-hidden="true">🐄</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

export function MoooberMap({
  start,
  end,
  route,
  approachRoute,
  driverPosition,
  dark,
  focusTarget,
  recenterToken,
  pickMode,
  onMapClick,
  onTileSourceChange,
}: MoooberMapProps) {
  const mapNode = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const tileLayerRef = useRef<TileLayer | null>(null)
  const tileSourceIndexRef = useRef(0)
  const tileErrorCountRef = useRef(0)
  const startMarkerRef = useRef<Marker | null>(null)
  const endMarkerRef = useRef<Marker | null>(null)
  const driverMarkerRef = useRef<Marker | null>(null)
  const routeLineRef = useRef<Polyline | null>(null)
  const approachLineRef = useRef<Polyline | null>(null)
  const ambientMarkersRef = useRef<Marker[]>([])
  const mapClickRef = useRef(onMapClick)
  const tileSourceChangeRef = useRef(onTileSourceChange)
  const [mapReady, setMapReady] = useState(false)

  mapClickRef.current = onMapClick
  tileSourceChangeRef.current = onTileSourceChange

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return

    let disposed = false

    const initializeMap = async () => {
      const module = await import('leaflet')
      const api = (module.default ?? module) as typeof import('leaflet')
      if (disposed || !mapNode.current || mapRef.current) return
      leaflet = api

      const map = api.map(mapNode.current, {
        zoomControl: false,
        preferCanvas: true,
        minZoom: 10,
        maxZoom: 19,
        zoomSnap: 0.5,
      }).setView(CENTER, 12)

      mapRef.current = map

      const installTileSource = (sourceIndex: number) => {
        const source = TILE_SOURCES[sourceIndex]
        if (!source) return

        if (tileLayerRef.current) {
          tileLayerRef.current.removeFrom(map)
        }

        tileErrorCountRef.current = 0
        tileSourceIndexRef.current = sourceIndex
        const tileLayer = api.tileLayer(source.url, {
          attribution: source.attribution,
          subdomains: source.subdomains,
          maxZoom: 19,
          maxNativeZoom: 19,
          crossOrigin: true,
          updateWhenZooming: false,
          keepBuffer: 3,
        })

        tileLayer.on('tileerror', () => {
          tileErrorCountRef.current += 1
          if (tileErrorCountRef.current >= 3 && sourceIndex < TILE_SOURCES.length - 1) {
            installTileSource(sourceIndex + 1)
          }
        })

        tileLayer.addTo(map)
        tileLayerRef.current = tileLayer
        tileSourceChangeRef.current?.(source.name)
      }

      installTileSource(0)
      api.control.zoom({ position: 'bottomright' }).addTo(map)

      map.on('click', (event) => {
        mapClickRef.current({ lat: event.latlng.lat, lng: event.latlng.lng })
      })

      setMapReady(true)
      window.setTimeout(() => map.invalidateSize(), 80)
    }

    void initializeMap()

    return () => {
      disposed = true
      ambientMarkersRef.current.forEach((marker) => marker.remove())
      ambientMarkersRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
      tileLayerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    const map = mapRef.current
    const timer = window.setInterval(() => {
      ambientMarkersRef.current.forEach((marker, index) => {
        const track = AMBIENT_TRACKS[index % AMBIENT_TRACKS.length]
        const nextPoint = track[(Date.now() / 1700 + index * 1.7) % track.length | 0]
        marker.setLatLng(nextPoint)
      })
    }, 1700)

    ambientMarkersRef.current = AMBIENT_TRACKS.map((track, index) =>
      leaflet!.marker(track[index % track.length], {
        interactive: false,
        icon: createAmbientIcon(index),
        opacity: index < 4 ? 0.9 : 0.58,
      }).addTo(map),
    )

    return () => {
      window.clearInterval(timer)
      ambientMarkersRef.current.forEach((marker) => marker.remove())
      ambientMarkersRef.current = []
    }
  }, [mapReady])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.getContainer().classList.toggle('mooober-map--dark', dark)
  }, [dark])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !focusTarget) return
    mapRef.current.flyTo([focusTarget.point.lat, focusTarget.point.lng], focusTarget.zoom ?? 14, {
      duration: 0.65,
    })
  }, [focusTarget, mapReady])

  useEffect(() => {
    if (!mapReady || !mapRef.current || recenterToken === 0) return
    mapRef.current.flyTo(CENTER, 12, { duration: 0.65 })
  }, [mapReady, recenterToken])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    if (start) {
      if (!startMarkerRef.current) {
        startMarkerRef.current = leaflet!.marker([start.lat, start.lng], {
          icon: createPinIcon('start'),
          keyboard: false,
          title: '上車點',
        }).addTo(map)
      } else {
        startMarkerRef.current.setLatLng([start.lat, start.lng])
      }
    } else if (startMarkerRef.current) {
      startMarkerRef.current.remove()
      startMarkerRef.current = null
    }
  }, [mapReady, start])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    if (end) {
      if (!endMarkerRef.current) {
        endMarkerRef.current = leaflet!.marker([end.lat, end.lng], {
          icon: createPinIcon('end'),
          keyboard: false,
          title: '目的地',
        }).addTo(map)
      } else {
        endMarkerRef.current.setLatLng([end.lat, end.lng])
      }
    } else if (endMarkerRef.current) {
      endMarkerRef.current.remove()
      endMarkerRef.current = null
    }
  }, [end, mapReady])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    routeLineRef.current?.remove()
    routeLineRef.current = null

    if (!route?.coords.length) return

    routeLineRef.current = leaflet!.polyline(route.coords, {
      color: '#111827',
      weight: 6,
      opacity: 0.82,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)

    if (start && end) {
      map.fitBounds(routeLineRef.current.getBounds(), { padding: [72, 72], maxZoom: 15 })
    }
  }, [end, mapReady, route, start])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    approachLineRef.current?.remove()
    approachLineRef.current = null

    if (!approachRoute?.length) return

    approachLineRef.current = leaflet!.polyline(approachRoute, {
      color: '#12b76a',
      weight: 5,
      opacity: 0.95,
      dashArray: '12 10',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map)
  }, [approachRoute, mapReady])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    if (!driverPosition) {
      driverMarkerRef.current?.remove()
      driverMarkerRef.current = null
      return
    }

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = leaflet!.marker([driverPosition.lat, driverPosition.lng], {
        icon: createPinIcon('driver'),
        keyboard: false,
        title: '接載中的牛',
        zIndexOffset: 500,
      }).addTo(map)
    } else {
      driverMarkerRef.current.setLatLng([driverPosition.lat, driverPosition.lng])
    }
  }, [driverPosition, mapReady])

  return (
    <div
      ref={mapNode}
      className={`mooober-map${dark ? ' mooober-map--dark' : ''}${pickMode ? ' mooober-map--picking' : ''}`}
      aria-label="屯門、元朗及天水圍互動地圖"
      role="application"
    />
  )
}
