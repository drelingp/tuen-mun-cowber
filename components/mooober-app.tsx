'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowUpRight,
  Car,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Crosshair,
  LocateFixed,
  MapPin,
  Moon,
  Navigation,
  Phone,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Sun,
  UserRound,
  X,
} from 'lucide-react'
import { MoooberMap, type MapPoint, type RouteData } from './mooober-map'

type LocationKind = 'start' | 'end'
type RideId = 'mooX' | 'mooComfort' | 'mooBlack'

type RideOption = {
  id: RideId
  name: string
  description: string
  etaBias: number
  base: number
  perKm: number
  perMin: number
  minFare: number
}

type ServiceArea = {
  name: string
  bounds: [[number, number], [number, number]]
}

const SERVICE_AREAS: ServiceArea[] = [
  { name: '屯門', bounds: [[22.351, 113.888], [22.458, 113.998]] },
  { name: '元朗', bounds: [[22.389, 113.932], [22.508, 114.076]] },
  { name: '天水圍', bounds: [[22.442, 113.978], [22.492, 114.033]] },
]

const RIDE_OPTIONS: RideOption[] = [
  {
    id: 'mooX',
    name: 'MooX',
    description: '平衡速度與價錢，日常出行首選',
    etaBias: 0.92,
    base: 18,
    perKm: 8.4,
    perMin: 1.15,
    minFare: 48,
  },
  {
    id: 'mooComfort',
    name: 'Moo Comfort',
    description: '坐感更穩陣，適合較長路程',
    etaBias: 1.02,
    base: 24,
    perKm: 10.1,
    perMin: 1.45,
    minFare: 62,
  },
  {
    id: 'mooBlack',
    name: 'Moo Black',
    description: '高級坐騎，外觀最有排場',
    etaBias: 1.08,
    base: 42,
    perKm: 13.8,
    perMin: 1.85,
    minFare: 98,
  },
]

const DRIVER_HUBS: MapPoint[] = [
  { lat: 22.3947, lng: 113.9736 },
  { lat: 22.411, lng: 113.9798 },
  { lat: 22.3708, lng: 113.9647 },
  { lat: 22.4469, lng: 114.0347 },
  { lat: 22.4486, lng: 114.0048 },
]

const TRIP_EVENTS = [
  '司牛剛經過紅綠燈口，路況正常。',
  '前方稍多牛流，已自動微調路線。',
  '牛隻精神良好，正在穩定前進。',
  '行程進行順利，預計可準時抵達。',
]

const AUTO_RIDER_NAMES = ['阿明', '小欣', '陳小明', '王家豪', '李嘉欣']

function createAutoRiderProfile() {
  const name = AUTO_RIDER_NAMES[Math.floor(Math.random() * AUTO_RIDER_NAMES.length)]
  const firstDigit = ['5', '6', '9'][Math.floor(Math.random() * 3)]
  const remainingDigits = Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')
  const digits = `${firstDigit}${remainingDigits}`

  return {
    name,
    phone: `${digits.slice(0, 4)} ${digits.slice(4)}`,
  }
}

function haversineKm(a: MapPoint, b: MapPoint) {
  const radians = (value: number) => value * Math.PI / 180
  const radius = 6371
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const halfLat = Math.sin(dLat / 2)
  const halfLng = Math.sin(dLng / 2)
  const value = halfLat * halfLat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * halfLng * halfLng
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function formatCoord(point: MapPoint | null) {
  if (!point) return '--'
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}

function formatMoney(value: number) {
  return `$${Math.round(value)}`
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

function validPhone(value: string) {
  const digits = digitsOnly(value)
  return digits.length >= 8 && digits.length <= 11
}

function serviceZone(point: MapPoint | null) {
  if (!point) return ''
  for (const area of SERVICE_AREAS) {
    const [[minLat, minLng], [maxLat, maxLng]] = area.bounds
    if (point.lat >= minLat && point.lat <= maxLat && point.lng >= minLng && point.lng <= maxLng) {
      return area.name
    }
  }
  return ''
}

function interpolatePoints(from: MapPoint, to: MapPoint, segments: number): Array<[number, number]> {
  const points: Array<[number, number]> = []
  const count = Math.max(2, segments)
  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1)
    points.push([
      from.lat + (to.lat - from.lat) * ratio,
      from.lng + (to.lng - from.lng) * ratio,
    ])
  }
  return points
}

function resamplePoints(points: Array<[number, number]>, targetCount: number) {
  if (points.length <= 2) return points
  const count = Math.max(2, targetCount)
  const result: Array<[number, number]> = []
  const last = points.length - 1

  for (let index = 0; index < count; index += 1) {
    const position = index / (count - 1) * last
    const baseIndex = Math.floor(position)
    const nextIndex = Math.min(last, baseIndex + 1)
    const ratio = position - baseIndex
    const [lat1, lng1] = points[baseIndex]
    const [lat2, lng2] = points[nextIndex]
    result.push([
      lat1 + (lat2 - lat1) * ratio,
      lng1 + (lng2 - lng1) * ratio,
    ])
  }

  return result
}

async function fetchOsrmRoute(from: MapPoint, to: MapPoint): Promise<RouteData> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error('route failed')
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route?.geometry?.coordinates?.length) throw new Error('route unavailable')

    return {
      coords: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
      km: route.distance / 1000,
      min: route.duration / 60,
      mode: 'route',
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

function estimatedRoute(from: MapPoint, to: MapPoint): RouteData {
  const km = haversineKm(from, to) * 1.23
  return {
    coords: [[from.lat, from.lng], [to.lat, to.lng]],
    km,
    min: Math.max(8, km / 22 * 60),
    mode: 'estimate',
  }
}

async function resolveRoute(from: MapPoint, to: MapPoint) {
  try {
    return await fetchOsrmRoute(from, to)
  } catch {
    return estimatedRoute(from, to)
  }
}

async function searchAddress(query: string) {
  const trimmed = query.trim()
  if (!trimmed) return null

  const coordinateMatch = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (coordinateMatch) {
    const point = { lat: Number(coordinateMatch[1]), lng: Number(coordinateMatch[2]) }
    if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return null
    return { point, label: `手動座標 ${trimmed}` }
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 4500)
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh-HK&q=${encodeURIComponent(`${trimmed}, Hong Kong`)}`

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error('search failed')
    const results = await response.json()
    if (!results.length) return null
    return {
      point: { lat: Number(results[0].lat), lng: Number(results[0].lon) },
      label: results[0].display_name || trimmed,
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

async function reverseGeocode(point: MapPoint) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 3500)
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=zh-HK&lat=${point.lat}&lon=${point.lng}`

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error('reverse failed')
    const data = await response.json()
    return data.display_name || `地圖選點 ${formatCoord(point)}`
  } catch {
    return `地圖選點 ${formatCoord(point)}`
  } finally {
    window.clearTimeout(timeout)
  }
}

function nearestDriver(point: MapPoint) {
  return DRIVER_HUBS.reduce((closest, candidate) => {
    return haversineKm(point, candidate) < haversineKm(point, closest) ? candidate : closest
  }, DRIVER_HUBS[0])
}

function LocationField({
  kind,
  point,
  label,
  locationLabel,
  draft,
  placeholder,
  onDraftChange,
  onSearch,
  onPick,
}: {
  kind: LocationKind
  point: MapPoint | null
  label: string
  locationLabel: string
  draft: string
  placeholder: string
  onDraftChange: (value: string) => void
  onSearch: () => void
  onPick: () => void
}) {
  const isStart = kind === 'start'

  return (
    <div className="location-field">
      <div className={`location-dot ${isStart ? 'location-dot--start' : 'location-dot--end'}`} aria-hidden="true" />
      <div className="location-field__content">
        <div className="location-field__heading">
          <div>
            <span className="eyebrow">{label}</span>
            <strong>{locationLabel || (isStart ? '設定上車地點' : '設定目的地')}</strong>
            <span className="location-field__meta">
              {point ? formatCoord(point) : (isStart ? '屯門、元朗或天水圍內上車' : '目的地不限地區')}
            </span>
          </div>
          <button type="button" className="location-map-button" onClick={onPick}>
            <MapPin aria-hidden="true" />
            地圖
          </button>
        </div>
        <div className="location-search">
          <input
            aria-label={`${label}地址`}
            value={draft}
            placeholder={placeholder}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') {
                event.preventDefault()
                onSearch()
              }
            }}
          />
          <button type="button" className="search-button" onClick={onSearch} aria-label={`搜尋${label}`}>
            <Search aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

function TripPanel({
  ride,
  startLabel,
  endLabel,
  route,
  tripPhase,
  tripStatus,
  tripProgress,
  tripEvents,
  tripCanFinish,
  onCancel,
  onFinish,
}: {
  ride: RideOption
  startLabel: string
  endLabel: string
  route: RouteData | null
  tripPhase: string
  tripStatus: string
  tripProgress: number
  tripEvents: string[]
  tripCanFinish: boolean
  onCancel: () => void
  onFinish: () => void
}) {
  return (
    <div className="trip-monitor">
      <div className="trip-banner">
        <div className="trip-banner__topline">
          <span className="live-dot" />
          <span>LIVE TRIP MONITOR</span>
        </div>
        <strong>{ride.name} 已接單</strong>
        <span>{tripPhase}</span>
      </div>

      <div className="trip-route-card">
        <div className="trip-route-card__row">
          <span>行程狀態</span>
          <strong>{tripStatus}</strong>
        </div>
        <div className="trip-route-card__row">
          <span>上車地點</span>
          <strong title={startLabel}>{startLabel}</strong>
        </div>
        <div className="trip-route-card__row">
          <span>目的地</span>
          <strong title={endLabel}>{endLabel}</strong>
        </div>
        <div className="trip-progress" aria-label={`行程進度 ${Math.round(tripProgress)}%`}>
          <span style={{ width: `${tripProgress}%` }} />
        </div>
        <div className="trip-stats">
          <div>
            <strong>{route ? route.km.toFixed(1) : '--'} <small>km</small></strong>
            <span>行車距離</span>
          </div>
          <div>
            <strong>{route ? Math.round(route.min) : '--'} <small>分鐘</small></strong>
            <span>預計車程</span>
          </div>
        </div>
      </div>

      <div className="trip-events" aria-live="polite">
        {tripEvents.length ? tripEvents.map((event, index) => <div key={`${event}-${index}`}>{event}</div>) : <div>正在同步道路狀態…</div>}
      </div>

      <button type="button" className="primary-button" onClick={onFinish} disabled={!tripCanFinish}>
        <Check aria-hidden="true" />
        已抵達
      </button>
      <button type="button" className="secondary-button" onClick={onCancel}>
        取消行程
      </button>
    </div>
  )
}

export default function MoooberApp() {
  const [start, setStart] = useState<MapPoint | null>(null)
  const [end, setEnd] = useState<MapPoint | null>(null)
  const [startLabel, setStartLabel] = useState('')
  const [endLabel, setEndLabel] = useState('')
  const [startDraft, setStartDraft] = useState('')
  const [endDraft, setEndDraft] = useState('')
  const [route, setRoute] = useState<RouteData | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [activeRide, setActiveRide] = useState<RideId>('mooX')
  const [pickMode, setPickMode] = useState<LocationKind | null>(null)
  const [mapDark, setMapDark] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ point: MapPoint; zoom?: number } | null>(null)
  const [recenterToken, setRecenterToken] = useState(0)
  const [tileSource, setTileSource] = useState('OpenStreetMap')
  const [resolvingLocation, setResolvingLocation] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [riderName, setRiderName] = useState('')
  const [riderPhone, setRiderPhone] = useState('')
  const [tripActive, setTripActive] = useState(false)
  const [tripPhase, setTripPhase] = useState('正在配對最近牛隻')
  const [tripStatus, setTripStatus] = useState('系統正計算道路距離')
  const [tripProgress, setTripProgress] = useState(0)
  const [tripEvents, setTripEvents] = useState<string[]>([])
  const [tripCanFinish, setTripCanFinish] = useState(false)
  const [driverPosition, setDriverPosition] = useState<MapPoint | null>(null)
  const [approachRoute, setApproachRoute] = useState<Array<[number, number]> | null>(null)
  const [arrivalOpen, setArrivalOpen] = useState(false)
  const [rating, setRating] = useState(5)
  const [ticket, setTicket] = useState('')
  const routeRequestRef = useRef(0)
  const tripTimerRef = useRef<number | null>(null)

  const activeRideOption = RIDE_OPTIONS.find((ride) => ride.id === activeRide) ?? RIDE_OPTIONS[0]
  const startZone = serviceZone(start)
  const routeReady = Boolean(start && end && route)
  const bookingReady = Boolean(routeReady && riderName.trim() && validPhone(riderPhone) && !routeLoading)

  useEffect(() => {
    const profile = createAutoRiderProfile()
    setRiderName(profile.name)
    setRiderPhone(profile.phone)
  }, [])

  useEffect(() => {
    return () => {
      if (tripTimerRef.current) window.clearInterval(tripTimerRef.current)
    }
  }, [])

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => {
      setNotice((current) => current === message ? null : current)
    }, 4200)
  }

  function fareFor(ride: RideOption) {
    if (!route) return ride.minFare
    const zoneFee = startZone === '天水圍' ? 4 : startZone === '元朗' ? 2 : 0
    return Math.max(ride.minFare, Math.round(ride.base + route.km * ride.perKm + route.min * ride.perMin + zoneFee))
  }

  async function updateRoute(nextStart: MapPoint | null, nextEnd: MapPoint | null) {
    const requestId = routeRequestRef.current + 1
    routeRequestRef.current = requestId
    setRoute(null)

    if (!nextStart || !nextEnd) {
      setRouteLoading(false)
      return
    }

    setRouteLoading(true)
    const nextRoute = await resolveRoute(nextStart, nextEnd)
    if (requestId !== routeRequestRef.current) return
    setRoute(nextRoute)
    setRouteLoading(false)
  }

  async function assignLocation(kind: LocationKind, point: MapPoint, label: string) {
    if (kind === 'start' && !serviceZone(point)) {
      showNotice('起點必須在屯門、元朗或天水圍範圍內。')
      return
    }

    const nextStart = kind === 'start' ? point : start
    const nextEnd = kind === 'end' ? point : end

    if (kind === 'start') {
      setStart(point)
      setStartLabel(label)
      setStartDraft(label)
    } else {
      setEnd(point)
      setEndLabel(label)
      setEndDraft(label)
    }

    setFocusTarget({ point, zoom: 14 })
    setPickMode(null)
    await updateRoute(nextStart, nextEnd)
  }

  async function handleMapClick(point: MapPoint) {
    if (!pickMode || resolvingLocation || tripActive) return
    setResolvingLocation(true)
    const label = await reverseGeocode(point)
    await assignLocation(pickMode, point, label)
    setResolvingLocation(false)
  }

  async function handleSearch(kind: LocationKind) {
    const draft = kind === 'start' ? startDraft : endDraft
    if (!draft.trim()) {
      showNotice(`請先輸入${kind === 'start' ? '起點' : '終點'}地址或座標。`)
      return
    }

    setResolvingLocation(true)
    try {
      const result = await searchAddress(draft)
      if (!result) {
        showNotice('找不到該位置，可改用地圖點選或輸入 lat,lng。')
        return
      }
      await assignLocation(kind, result.point, result.label)
    } catch {
      showNotice('地址搜尋暫時不可用，可改用地圖點選或輸入座標。')
    } finally {
      setResolvingLocation(false)
    }
  }

  function resetRoute() {
    routeRequestRef.current += 1
    setStart(null)
    setEnd(null)
    setStartLabel('')
    setEndLabel('')
    setStartDraft('')
    setEndDraft('')
    setRoute(null)
    setRouteLoading(false)
    setPickMode(null)
    setFocusTarget(null)
    setRecenterToken((value) => value + 1)
  }

  function stopTripTimer() {
    if (tripTimerRef.current) {
      window.clearInterval(tripTimerRef.current)
      tripTimerRef.current = null
    }
  }

  function addTripEvent(event: string) {
    setTripEvents((current) => [event, ...current].slice(0, 5))
  }

  function startTrip() {
    if (!start || !end || !route || !bookingReady) {
      showNotice('請先完成起點、終點及騎士資料。')
      return
    }

    stopTripTimer()
    const driverStart = nearestDriver(start)
    const approach = resamplePoints(interpolatePoints(driverStart, start, 18), 18)
    const journey = resamplePoints(route.coords, 54)
    const path = [...approach, ...journey.slice(1)]
    const pickupStep = approach.length - 1
    const totalSteps = path.length - 1
    const tripTicket = `MOO-${Date.now().toString(36).toUpperCase()}`

    setTicket(tripTicket)
    setTripActive(true)
    setTripCanFinish(false)
    setTripProgress(0)
    setTripPhase('最近的牛正在前往起點')
    setTripStatus('正在沿道路網前往你的上車位置')
    setTripEvents(['系統已接單，正在配對最近的巡航牛。'])
    setDriverPosition(driverStart)
    setApproachRoute(approach)
    setPickMode(null)

    let step = 0
    tripTimerRef.current = window.setInterval(() => {
      step += 1
      const point = path[Math.min(step, path.length - 1)]
      const progress = Math.min(100, step / totalSteps * 100)
      setDriverPosition({ lat: point[0], lng: point[1] })
      setTripProgress(progress)

      if (step < pickupStep) {
        setTripPhase('最近的牛正在前往起點')
        setTripStatus('牛正沿道路網趕去你的上車位置')
      } else if (step === pickupStep) {
        setTripPhase('牛已到達起點')
        setTripStatus('騎士上牛中，準備出發')
        addTripEvent('牛已抵達上車點，準備出發。')
      } else if (progress < 78) {
        setTripPhase(`從${startZone || '上車點'}出發`)
        setTripStatus('已接載騎士，正在前往目的地')
        setApproachRoute(null)
      } else if (progress < 100) {
        setTripPhase('即將抵達目的地')
        setTripStatus('牛正進入終點附近路段')
        setApproachRoute(null)
      }

      if (step === Math.round(totalSteps * 0.42)) addTripEvent(TRIP_EVENTS[0])
      if (step === Math.round(totalSteps * 0.66)) addTripEvent(TRIP_EVENTS[1])
      if (step === Math.round(totalSteps * 0.86)) addTripEvent(TRIP_EVENTS[2])

      if (step >= totalSteps) {
        stopTripTimer()
        setDriverPosition(end)
        setTripProgress(100)
        setTripPhase('今次接載已完成')
        setTripStatus('已抵達目的地，請完成行程')
        setTripCanFinish(true)
        setApproachRoute(null)
        addTripEvent('已抵達目的地，請按「已抵達」完成行程。')
      }
    }, 430)
  }

  function cancelTrip() {
    stopTripTimer()
    setTripActive(false)
    setTripCanFinish(false)
    setTripProgress(0)
    setDriverPosition(null)
    setApproachRoute(null)
    setTripEvents([])
    showNotice('行程已取消，起點及終點仍然保留。')
  }

  function finishTrip() {
    stopTripTimer()
    setArrivalOpen(true)
  }

  function resetAfterArrival() {
    setArrivalOpen(false)
    setTripActive(false)
    setTripCanFinish(false)
    setDriverPosition(null)
    setApproachRoute(null)
    setTripEvents([])
    setRating(5)
    resetRoute()
  }

  return (
    <main className="mooober-app">
      <section className={`booking-sheet${tripActive ? ' booking-sheet--trip' : ''}${pickMode ? ' booking-sheet--picking' : ''}`} aria-label="叫牛行程設定">
        <div className="sheet-handle" aria-hidden="true" />
        {tripActive ? (
          <TripPanel
            ride={activeRideOption}
            startLabel={startLabel || formatCoord(start)}
            endLabel={endLabel || formatCoord(end)}
            route={route}
            tripPhase={tripPhase}
            tripStatus={tripStatus}
            tripProgress={tripProgress}
            tripEvents={tripEvents}
            tripCanFinish={tripCanFinish}
            onCancel={cancelTrip}
            onFinish={finishTrip}
          />
        ) : (
          <div className="booking-content">
            <div className="brand-row">
              <div>
                <span className="brand-kicker">屯元天騎牛叫車</span>
                <h1>Go anywhere.<br />Ride a bull.</h1>
              </div>
              <div className="fare-chip">
                <strong>{formatMoney(fareFor(activeRideOption))}</strong>
                <span>{routeReady ? '即時車資' : '最低起跳'}</span>
              </div>
            </div>

            <div className="map-source-badge">
              <span className="source-status" />
              <span>{tileSource} · 免費開源地圖</span>
            </div>

            <div className="location-card">
              <LocationField
                kind="start"
                point={start}
                label="Pickup"
                locationLabel={startLabel}
                draft={startDraft}
                placeholder="輸入起點地址或 lat,lng"
                onDraftChange={setStartDraft}
                onSearch={() => handleSearch('start')}
                onPick={() => setPickMode('start')}
              />
              <LocationField
                kind="end"
                point={end}
                label="Dropoff"
                locationLabel={endLabel}
                draft={endDraft}
                placeholder="輸入終點地址或 lat,lng"
                onDraftChange={setEndDraft}
                onSearch={() => handleSearch('end')}
                onPick={() => setPickMode('end')}
              />
            </div>

            <div className="service-tags" aria-label="服務範圍">
              {SERVICE_AREAS.map((area) => <span key={area.name} className={startZone === area.name ? 'is-active' : ''}>{area.name} 可上車</span>)}
              <span className={route?.mode === 'route' ? 'is-active' : ''}>{routeLoading ? '正在計算路線…' : route?.mode === 'route' ? 'OSRM 開源路線' : '等待路線'}</span>
            </div>

            {start && !startZone && (
              <div className="inline-alert inline-alert--danger">
                <CircleAlert aria-hidden="true" />
                <span>起點不在屯門、元朗或天水圍服務範圍內。</span>
              </div>
            )}

            {route?.mode === 'estimate' && (
              <div className="inline-alert">
                <CircleAlert aria-hidden="true" />
                <span>路線服務暫時未回應，已改用保守距��估算，仍可繼續模擬行程。</span>
              </div>
            )}

            <div className="metric-grid">
              <div><strong>{route ? `${route.km.toFixed(1)} km` : '--'}</strong><span>行車距離</span></div>
              <div><strong>{route ? `${Math.round(route.min)} 分鐘` : '--'}</strong><span>預計車程</span></div>
              <div><strong>{startZone || '--'}</strong><span>上車分區</span></div>
            </div>

            <div className="section-heading">
              <strong>選擇車種</strong>
              <span>即時計價</span>
            </div>
            <div className="ride-grid">
              {RIDE_OPTIONS.map((ride) => {
                const selected = ride.id === activeRide
                const eta = route ? Math.max(3, Math.round(route.min * ride.etaBias)) : null
                return (
                  <button type="button" key={ride.id} className={`ride-card${selected ? ' is-selected' : ''}`} onClick={() => setActiveRide(ride.id)}>
                    <span className="ride-icon" aria-hidden="true"><Car /></span>
                    <span className="ride-copy">
                      <strong>{ride.name}</strong>
                      <span>{ride.description}</span>
                      <em>{eta ? `${eta} 分鐘到達` : '等待路線'}</em>
                    </span>
                    <span className="ride-price"><strong>{formatMoney(fareFor(ride))}</strong><span>{selected ? <Check aria-label="已選擇" /> : <ChevronRight aria-hidden="true" />}</span></span>
                  </button>
                )
              })}
            </div>

            <div className="fare-detail-card">
              <div><span>車資結構</span><strong>{activeRideOption.name} · 基本 {formatMoney(activeRideOption.base)}</strong></div>
              <div><span>里程單價</span><strong>{formatMoney(activeRideOption.perKm)} / km</strong></div>
              <div><span>時間單價</span><strong>{formatMoney(activeRideOption.perMin)} / 分鐘</strong></div>
              <div><span>計算來源</span><strong>{route?.mode === 'route' ? 'OSRM 開源路線' : route?.mode === 'estimate' ? '距離修正估算' : '等待起點與終點'}</strong></div>
              <div><span>合計</span><strong>{formatMoney(fareFor(activeRideOption))}</strong></div>
            </div>

            <div className="rider-fields">
              <label>
                <span><UserRound aria-hidden="true" />騎士姓名</span>
                <input value={riderName} onChange={(event) => setRiderName(event.target.value)} placeholder="例如：阿明" autoComplete="name" />
              </label>
              <label>
                <span><Phone aria-hidden="true" />聯絡電話</span>
                <input value={riderPhone} onChange={(event) => setRiderPhone(event.target.value)} placeholder="例如：9123 4567" inputMode="numeric" autoComplete="tel" />
              </label>
            </div>

            <button type="button" className="primary-button primary-button--book" onClick={startTrip} disabled={!bookingReady}>
              <Navigation aria-hidden="true" />
              {routeLoading ? '計算路線中…' : `確認叫牛 ${formatMoney(fareFor(activeRideOption))}`}
              <ArrowUpRight aria-hidden="true" />
            </button>
            <button type="button" className="secondary-button" onClick={resetRoute}>
              <RotateCcw aria-hidden="true" />
              重設起點 / 終點
            </button>
          </div>
        )}
      </section>

      <section className="map-shell" aria-label="開源地圖">
        <MoooberMap
          start={start}
          end={end}
          route={route}
          approachRoute={approachRoute}
          driverPosition={driverPosition}
          dark={mapDark}
          focusTarget={focusTarget}
          recenterToken={recenterToken}
          pickMode={pickMode}
          onMapClick={handleMapClick}
          onTileSourceChange={setTileSource}
        />

        <div className="map-toolbar">
          <button type="button" className={mapDark ? 'is-active' : ''} onClick={() => setMapDark((value) => !value)} aria-label={mapDark ? '切換淺色地圖' : '切換深色地圖'}>
            {mapDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => setRecenterToken((value) => value + 1)} aria-label="回到屯門服務範圍">
            <LocateFixed aria-hidden="true" />
          </button>
        </div>

        <div className="map-label">
          <div className="map-label__icon"><Route aria-hidden="true" /></div>
          <div>
            <strong>屯元天服務範圍</strong>
            <span>{tileSource} · 免費開源地圖</span>
          </div>
        </div>

        {pickMode && (
          <div className="pick-banner">
            <div>
              <strong>{resolvingLocation ? '正在讀取位置…' : `請在地圖點選${pickMode === 'start' ? '起點' : '終點'}`}</strong>
              <span>{pickMode === 'start' ? '起點必須在屯門、元朗或天水圍範圍內' : '終點不限地區'}</span>
            </div>
            <button type="button" onClick={() => setPickMode(null)} aria-label="取消地圖選點"><X aria-hidden="true" />取消</button>
          </div>
        )}

        {notice && (
          <div className="map-notice" role="status">
            <CircleAlert aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
      </section>

      {arrivalOpen && (
        <div className="arrival-overlay" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
          <div className="arrival-card">
            <button type="button" className="arrival-close" onClick={() => setArrivalOpen(false)} aria-label="關閉"><X aria-hidden="true" /></button>
            <div className="arrival-icon"><CircleCheck aria-hidden="true" /></div>
            <span className="eyebrow">TRIP COMPLETE</span>
            <h2 id="arrival-title">已成功入屯門</h2>
            <p>{riderName || '騎士'}，你已完成今次 {activeRideOption.name} 行程。</p>
            <div className="arrival-summary">
              <div><span>起點</span><strong>{startLabel || formatCoord(start)}</strong></div>
              <div><span>終點</span><strong>{endLabel || formatCoord(end)}</strong></div>
              <div><span>距離</span><strong>{route ? `${route.km.toFixed(1)} km` : '--'}</strong></div>
              <div><span>車資</span><strong>{formatMoney(fareFor(activeRideOption))}</strong></div>
            </div>
            <div className="ticket-line">行程編號：{ticket}</div>
            <div className="rating-row" aria-label="評分">
              {[1, 2, 3, 4, 5].map((value) => (
                <button type="button" key={value} className={value <= rating ? 'is-rated' : ''} onClick={() => setRating(value)} aria-label={`${value} 星`}>
                  <span>★</span>
                </button>
              ))}
            </div>
            <button type="button" className="primary-button" onClick={resetAfterArrival}>再叫一程</button>
          </div>
        </div>
      )}
    </main>
  )
}
