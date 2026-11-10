/**
 * Khai báo trang phục và các lớp SVG người làm vườn để hồ sơ có thể tạo chuyển động thân, mắt và cánh tay riêng.
 */

import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

import { COLORS as c } from "@/theme";
import type { GardenerOutfit } from "@/types/app";

// Original PAT vector assets. These pure art layers share theme colors and
// remain separate so the profile can animate the body, eyes and waving arm.
// Illustration coordinates belong to the artboard, not the spacing scale.
export const OUTFITS = [
  {
    id: "leaf",
    name: "Lá non",
    description: "Yếm làm vườn & mũ mầm cây",
    color: c.leafBright,
  },
  {
    id: "sun",
    name: "Nắng mai",
    description: "Mũ rộng vành & túi hạt giống",
    color: c.sunshine,
  },
  {
    id: "rain",
    name: "Ngày mưa",
    description: "Áo mưa & đôi ủng vàng",
    color: c.water,
  },
] as const;

export function GardenerGroundArtwork() {
  return (
    <Svg width={240} height={280} viewBox="0 0 240 280">
      <Ellipse
        cx={120}
        cy={265}
        rx={77}
        ry={10}
        fill={c.sageDeep}
        opacity={0.45}
      />
      <Path
        d="M35 256Q22 239 28 226Q48 231 42 253M198 256Q213 243 207 231Q189 234 192 251"
        fill={c.leafBright}
      />
    </Svg>
  );
}

export function GardenerBodyArtwork({ outfit }: { outfit: GardenerOutfit }) {
  const shirt =
    outfit === "rain" ? c.water : outfit === "sun" ? c.sunshine : c.leafBright;
  const clothing =
    outfit === "rain" ? c.blue : outfit === "sun" ? c.soil : c.primary;
  return (
    <Svg width={240} height={280} viewBox="0 0 240 280">
      <Rect
        x={86}
        y={219}
        width={29}
        height={40}
        rx={12}
        fill={clothing}
      />
      <Rect
        x={129}
        y={219}
        width={29}
        height={40}
        rx={12}
        fill={clothing}
      />
      <Path
        d="M83 246H114V264H78Q73 254 83 246M130 246H158Q169 253 165 264H130Z"
        fill={outfit === "rain" ? c.sunshine : c.soil}
      />
      <Path
        d="M83 157Q65 154 54 177L45 208Q44 221 55 225Q67 228 72 213L84 187Z"
        fill={shirt}
      />
      <Ellipse cx={53} cy={221} rx={11} ry={13} fill={c.skin} />
      <Path
        d="M88 152Q121 140 153 152Q169 173 169 223Q124 244 77 222Q76 180 88 152Z"
        fill={shirt}
      />
      <Rect
        x={108}
        y={135}
        width={26}
        height={30}
        rx={11}
        fill={c.skinShade}
      />
      {outfit === "leaf" ? (
        <>
          <Path
            d="M92 153L103 154V180H144V154L155 158V225Q120 237 86 223V178H92Z"
            fill={clothing}
          />
          <Circle cx={100} cy={180} r={4} fill={c.sunshine} />
          <Circle cx={148} cy={180} r={4} fill={c.sunshine} />
          <Path
            d="M108 197H140V214Q124 224 108 214Z"
            fill={c.leafBright}
          />
          <Path
            d="M123 212Q113 203 119 198Q128 197 123 212M124 209Q129 198 134 201Q138 207 124 209"
            fill={c.primaryDark}
          />
        </>
      ) : outfit === "sun" ? (
        <>
          <Path d="M146 155L152 160L100 222L94 216Z" fill={c.soil} />
          <Rect
            x={83}
            y={195}
            width={39}
            height={32}
            rx={10}
            fill={c.soil}
          />
          <Path d="M90 199H116V207H90Z" fill={c.skin} />
          <Circle cx={123} cy={176} r={4} fill={c.soil} />
        </>
      ) : (
        <>
          <Path d="M121 162V231" stroke={c.blue} strokeWidth={4} />
          <Path
            d="M88 200H109V214H88M136 200H157V214H136"
            fill={c.blue}
          />
          <Path
            d="M121 155L106 163L115 176L123 164L132 176L140 163Z"
            fill={c.sunshine}
          />
        </>
      )}
      {outfit === "rain" && (
        <Path
          d="M61 103Q58 31 121 31Q184 31 184 105L177 146L62 143Z"
          fill={c.blue}
        />
      )}
      <Ellipse cx={69} cy={111} rx={11} ry={15} fill={c.skinShade} />
      <Ellipse cx={173} cy={111} rx={11} ry={15} fill={c.skinShade} />
      <Path
        d="M68 83Q68 49 122 49Q175 49 175 86V112Q175 151 122 154Q68 151 68 112Z"
        fill={c.skin}
      />
      <Path
        d="M68 97Q53 54 93 45Q142 29 172 60L177 96L165 88L158 70Q145 89 127 69Q111 91 91 73L79 99Z"
        fill={c.hair}
      />
      <Ellipse
        cx={88}
        cy={125}
        rx={11}
        ry={6}
        fill={c.skinShade}
        opacity={0.6}
      />
      <Ellipse
        cx={155}
        cy={125}
        rx={11}
        ry={6}
        fill={c.skinShade}
        opacity={0.6}
      />
      <Path
        d="M118 117Q111 128 124 127"
        stroke={c.skinShade}
        strokeWidth={4}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M109 134Q122 146 135 134"
        stroke={c.hair}
        strokeWidth={4}
        fill="none"
        strokeLinecap="round"
      />
      {outfit === "rain" ? (
        <Path
          d="M63 79Q63 35 121 35Q179 35 179 79Q147 57 121 62Q88 60 63 79Z"
          fill={c.water}
        />
      ) : (
        <>
          <Path
            d="M74 65L82 36Q122 17 160 36L169 65Z"
            fill={outfit === "sun" ? c.sunshine : c.primary}
          />
          <Path
            d="M81 52Q122 42 163 52L169 65L75 65Z"
            fill={outfit === "sun" ? c.soil : c.leafBright}
          />
          <Ellipse
            cx={121}
            cy={67}
            rx={outfit === "sun" ? 79 : 67}
            ry={12}
            fill={outfit === "sun" ? c.sunshine : c.primary}
          />
          {outfit === "leaf" && (
            <Path
              d="M121 39Q98 25 111 15Q130 15 124 37Q127 9 143 12Q151 30 125 39"
              fill={c.leafBright}
            />
          )}
        </>
      )}
    </Svg>
  );
}

export function GardenerEyesArtwork() {
  return (
    <Svg width={68} height={32} viewBox="0 0 68 32">
      <Ellipse cx={13} cy={16} rx={12} ry={16} fill={c.white} />
      <Ellipse cx={55} cy={16} rx={12} ry={16} fill={c.white} />
      <Ellipse cx={16} cy={17} rx={6} ry={10} fill={c.hair} />
      <Ellipse cx={52} cy={17} rx={6} ry={10} fill={c.hair} />
      <Circle cx={18} cy={13} r={2} fill={c.white} />
      <Circle cx={54} cy={13} r={2} fill={c.white} />
    </Svg>
  );
}

export function GardenerArmArtwork({ outfit }: { outfit: GardenerOutfit }) {
  const shirt =
    outfit === "rain" ? c.water : outfit === "sun" ? c.sunshine : c.leafBright;
  return (
    <Svg width={59} height={88} viewBox="0 0 59 88">
      <Path
        d="M7 57Q24 68 29 49L32 31Q43 26 49 36L48 61Q44 88 17 83L2 74Z"
        fill={shirt}
      />
      <Path
        d="M32 35L29 23Q28 18 33 18L36 28L37 11Q40 5 43 12L43 26L47 14Q52 10 53 16L50 30Q59 23 59 30L51 44Q41 52 32 35Z"
        fill={c.skin}
      />
    </Svg>
  );
}
