// 太陽の位置の計算（簡易式）。時刻は日本標準時。打ち合わせで日当たりの傾向を見せるための精度

const RAD = Math.PI / 180;

export type SunPosition = {
  // 高度（度）。0 未満は日没後
  altitude: number;
  // 方位（度）。北から時計回り
  azimuth: number;
};

const dayOfYear = (month: number, day: number) =>
  Math.round(
    (Date.UTC(2026, month - 1, day) - Date.UTC(2026, 0, 0)) / 86400000,
  );

export function sunPosition(
  lat: number,
  lon: number,
  month: number,
  day: number,
  hours: number,
): SunPosition {
  const n = dayOfYear(month, day);
  const b = ((n - 81) * 360 * RAD) / 364;
  // 均時差（分）と赤緯
  const equation = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const declination = 23.45 * Math.sin(((284 + n) * 360 * RAD) / 365) * RAD;
  const solar = hours + (lon - 135) / 15 + equation / 60;
  const hour = (solar - 12) * 15 * RAD;
  const phi = lat * RAD;
  const sinAltitude =
    Math.sin(phi) * Math.sin(declination) +
    Math.cos(phi) * Math.cos(declination) * Math.cos(hour);
  const altitude = Math.asin(sinAltitude);
  const azimuth = Math.atan2(
    -Math.cos(declination) * Math.sin(hour),
    Math.sin(declination) * Math.cos(phi) -
      Math.cos(declination) * Math.cos(hour) * Math.sin(phi),
  );
  return {
    altitude: altitude / RAD,
    azimuth: ((azimuth / RAD) + 360) % 360,
  };
}

// 建物の座標（x, y が平面、z が上）で、太陽のある向きの単位ベクトル。northDeg は +y が真北から時計回りに何度か
export function sunDirection(sun: SunPosition, northDeg: number) {
  const relative = (sun.azimuth - northDeg) * RAD;
  const altitude = sun.altitude * RAD;
  return {
    x: Math.cos(altitude) * Math.sin(relative),
    y: Math.cos(altitude) * Math.cos(relative),
    z: Math.sin(altitude),
  };
}

const COMPASS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
export const compassName = (azimuth: number) =>
  COMPASS[Math.round(azimuth / 45) % 8];

export const SEASONS = [
  { label: "冬至", month: 12, day: 22 },
  { label: "春分", month: 3, day: 20 },
  { label: "夏至", month: 6, day: 21 },
];
