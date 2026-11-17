import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../ThemeContext';

const ICON_COLORS = {
  sun: '#ffd166',
  moon: '#eaf0fc',
  cloudLight: '#c3cee6',
  cloudDark: '#9fb0d6',
  drop: '#5b9bd5',
  snow: '#f2f7ff',
  fog: '#aab6cf',
};

const THUNDER_BOLT_PATHS = [
  'M32 14 L26 54 L32 54 L28 64 L40 46 L36 46',
  'M34 14 L40 50 L34 50 L38 62 L30 44 L33 44',
  'M30 46 L26 60 L34 60 L30 46',
];

function CloudShape({ x = 0, y = 0, s = 1, fill }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Circle cx={21} cy={33} r={9} fill={fill} />
      <Circle cx={32} cy={27} r={11.5} fill={fill} />
      <Circle cx={43} cy={34} r={8} fill={fill} />
      <Rect x={12} y={37} width={40} height={9} rx={4.5} fill={fill} />
    </G>
  );
}

function SunCore({ x = 0, y = 0, s = 1 }) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    rays.push(
      <Line key={i}
        x1={x + Math.cos(a) * 13 * s} y1={y + Math.sin(a) * 13 * s}
        x2={x + Math.cos(a) * 18 * s} y2={y + Math.sin(a) * 18 * s}
        stroke={ICON_COLORS.sun} strokeWidth={3 * s} strokeLinecap="round" />
    );
  }
  return (
    <G>
      {rays}
      <Circle cx={x} cy={y} r={9 * s} fill={ICON_COLORS.sun} />
    </G>
  );
}

function MoonCrescent({ transform }) {
  const { theme } = useTheme();
  const fill = theme.mode === 'light' ? '#6b7c9e' : '#eaf0fc';
  return (
    <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
      fill={fill} transform={transform} />
  );
}

function GithubIcon({ size = 22, color = '#eaf0fc' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path fillRule="evenodd" clipRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        fill={color} />
    </Svg>
  );
}

function RainLayer({ size, heavy }) {
  const scale = size / 64;
  const dropsRef = useRef(null);
  if (dropsRef.current === null) {
    const count = heavy ? 7 : 5;
    dropsRef.current = Array.from({ length: count }, (_, i) => ({
      v: new Animated.Value(0),
      left: 19 + ((i * 47) % 27),
      cycle: 900 + ((i * 137) % 420),
      len: heavy && i % 2 === 0 ? 11 : 8,
    }));
  }
  const drops = dropsRef.current;
  useEffect(() => {
    const loops = drops.map((d) =>
      Animated.loop(
        Animated.timing(d.v, {
          toValue: 1,
          duration: d.cycle,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [drops]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {drops.map((d, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: d.left * scale,
            top: 44 * scale,
            width: Math.max(2, 3 * scale),
            height: d.len * scale,
            borderRadius: Math.max(1, 1.5 * scale),
            backgroundColor: ICON_COLORS.drop,
            opacity: 0.85,
            transform: [
              {
                translateY: d.v.interpolate({
                  inputRange: [0, 0.18, 0.8, 1],
                  outputRange: [-6 * scale, -6 * scale, 24 * scale, 24 * scale],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}

function SnowLayer({ size }) {
  const { theme } = useTheme();
  const scale = size / 64;
  const fill = theme.mode === 'light' ? '#8fa4c9' : ICON_COLORS.snow;
  const flakesRef = useRef(null);
  if (flakesRef.current === null) {
    flakesRef.current = Array.from({ length: 10 }, (_, i) => ({
      v: new Animated.Value(0),
      left: 15 + ((i * 29) % 33),
      dia: 3 + ((i * 7) % 7) * 0.5,
      cycle: 1600 + ((i * 173) % 1300),
      amp: 1.5 + (i % 3),
    }));
  }
  const flakes = flakesRef.current;
  useEffect(() => {
    const loops = flakes.map((f) =>
      Animated.loop(
        Animated.timing(f.v, {
          toValue: 1,
          duration: f.cycle,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [flakes]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {flakes.map((f, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: f.left * scale,
            top: 42 * scale,
            width: Math.max(2, f.dia * scale),
            height: Math.max(2, f.dia * scale),
            borderRadius: Math.max(1, (f.dia * scale) / 2),
            backgroundColor: fill,
            opacity: 0.9,
            transform: [
              {
                translateX: f.v.interpolate({
                  inputRange: [0, 0.25, 0.5, 0.75, 1],
                  outputRange: [0, f.amp * scale, 0, -f.amp * scale, 0],
                }),
              },
              {
                translateY: f.v.interpolate({
                  inputRange: [0, 0.12, 0.82, 1],
                  outputRange: [-8 * scale, -8 * scale, 24 * scale, 24 * scale],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}

function DriftCloud({ size, fill, offsetX = 0, offsetY = 0, s = 1 }) {
  const scale = size / 64;
  const u = (v) => v * scale * s;
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, {
          toValue: 1,
          duration: 3500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(x, {
          toValue: 0,
          duration: 3500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const translateX = x.interpolate({
    inputRange: [0, 1],
    outputRange: [-3 * scale, 3 * scale],
  });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: 'absolute',
          left: offsetX * scale,
          top: offsetY * scale,
          width: 64 * scale * s,
          height: 64 * scale * s,
          transform: [{ translateX }],
        }}
      >
        <View style={{ position: 'absolute', left: u(12), top: u(24), width: u(18), height: u(18), borderRadius: u(9), backgroundColor: fill }} />
        <View style={{ position: 'absolute', left: u(20.5), top: u(15.5), width: u(23), height: u(23), borderRadius: u(11.5), backgroundColor: fill }} />
        <View style={{ position: 'absolute', left: u(35), top: u(26), width: u(16), height: u(16), borderRadius: u(8), backgroundColor: fill }} />
        <View style={{ position: 'absolute', left: u(12), top: u(37), width: u(40), height: u(9), borderRadius: u(4.5), backgroundColor: fill }} />
      </Animated.View>
    </View>
  );
}

function ThunderWeather({ size }) {
  const scale = size / 64;
  const originX = 32 * scale;
  const originY = 34 * scale;
  const burstR = 36 * scale;

  const forkOps = useRef(null);
  if (forkOps.current === null) {
    forkOps.current = THUNDER_BOLT_PATHS.map(() => new Animated.Value(0));
  }
  const forkOpsValues = forkOps.current;
  const burstScale = useRef(new Animated.Value(1)).current;
  const burstOp = useRef(new Animated.Value(0)).current;
  const flashOp = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const animRef = useRef(null);
  const [lit, setLit] = useState(false);

  const runStrike = (forkIndex) => {
    const op = forkOpsValues[forkIndex];
    op.setValue(0);
    setLit(true);
    Animated.sequence([
      Animated.timing(op, {
        toValue: 0.85,
        duration: 70,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(op, {
        toValue: 0,
        duration: 240,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setLit(false));
  };

  const runBurst = () => {
    const hitCount = 2 + Math.floor(Math.random() * 2);
    let fired = 0;
    const fireNext = () => {
      runStrike(fired % THUNDER_BOLT_PATHS.length);
      fired += 1;
      if (fired < hitCount) {
        animRef.current = setTimeout(fireNext, 120 + Math.random() * 80);
      } else {
        animRef.current = setTimeout(runStorm, 2200 + Math.random() * 3200);
      }
    };
    burstScale.setValue(0.3);
    burstOp.setValue(0);
    flashOp.setValue(0);
    shake.setValue(0);
    Animated.parallel([
      Animated.timing(burstScale, {
        toValue: 1.6,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(burstOp, { toValue: 0.9, duration: 90, useNativeDriver: true }),
        Animated.timing(burstOp, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(flashOp, { toValue: 0.55, duration: 80, useNativeDriver: true }),
        Animated.timing(flashOp, {
          toValue: 0,
          duration: 280,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 150, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 140, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ]).start();
    fireNext();
  };

  const runStorm = () => {
    runBurst();
  };

  useEffect(() => {
    let cancelled = false;
    const first = () => {
      if (cancelled) return;
      runStorm();
    };
    animRef.current = setTimeout(first, 800 + Math.random() * 1400);
    return () => {
      cancelled = true;
      if (animRef.current) clearTimeout(animRef.current);
      forkOpsValues.forEach((o) => o.stopAnimation());
      [burstScale, burstOp, flashOp, shake].forEach((v) => v.stopAnimation());
    };
  }, []);

  const shakeX = shake.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [-3 * scale, -2 * scale, 3 * scale, 2 * scale, 0],
  });
  const shakeY = shake.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, -2 * scale, 0],
  });

  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      <Animated.View
        style={{
          width: size,
          height: size,
          transform: [{ translateX: shakeX }, { translateY: shakeY }],
        }}
      >
        <Svg width={size} height={size} viewBox="0 0 64 64">
          <G>
            <CloudShape y={-2} fill={lit ? '#cbd6ec' : ICON_COLORS.cloudDark} />
          </G>
        </Svg>

        {THUNDER_BOLT_PATHS.map((d, i) => (
          <Animated.View
            key={`bolt-${i}`}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { width: size, height: size, opacity: forkOpsValues[i] }]}
          >
            <Svg width={size} height={size} viewBox="0 0 64 64">
              <G>
                <Path
                  d={d}
                  stroke={ICON_COLORS.sun}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <Path
                  d={d}
                  stroke="rgba(255, 255, 0, 0.35)"
                  strokeWidth={4.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </G>
            </Svg>
          </Animated.View>
        ))}

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#fff9c4', opacity: flashOp }]}
        />

        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: originX - burstR,
            top: originY - burstR,
            width: burstR * 2,
            height: burstR * 2,
            opacity: burstOp,
            transform: [{ scale: burstScale }],
          }}
        >
          <Svg width={burstR * 2} height={burstR * 2} viewBox="0 0 64 64">
            <Defs>
              <RadialGradient id="thunderBurst" cx="32" cy="32" r="32" fx="32" fy="32">
                <Stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
                <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={32} cy={32} r={32} fill="url(#thunderBurst)" />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function ForecastFogAnimation({ size = 26 }) {
  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;
  const anim3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createLoop = (anim, delay = 0) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 4000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 4000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    };

    const l1 = createLoop(anim1, 0);
    const l2 = createLoop(anim2, 100);
    const l3 = createLoop(anim3, 200);

    l1.start();
    l2.start();
    l3.start();

    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [anim1, anim2, anim3]);

  const translateX1 = anim1.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
  const translateX2 = anim2.interpolate({ inputRange: [0, 1], outputRange: [0, 6] });
  const translateX3 = anim3.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });

  return (
    <View style={{ width: size, height: size * 0.833, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size * 0.833} viewBox="0 0 120 100">
        <Path
          d="M 45 78
             L 95 78
             A 16 16 0 0 0 111 62
             A 15 15 0 0 0 99 48
             A 22 22 0 0 0 58 35
             A 25 25 0 0 0 35 55
             A 16 16 0 0 0 45 78 Z"
          fill="#CFD8DC"
        />
        <AnimatedLine
          x1="35"
          y1="58"
          x2="75"
          y2="58"
          stroke="#B0BEC5"
          strokeWidth="6"
          strokeLinecap="round"
          style={{ transform: [{ translateX: translateX1 }] }}
        />
        <AnimatedLine
          x1="22"
          y1="71"
          x2="80"
          y2="71"
          stroke="#B0BEC5"
          strokeWidth="6"
          strokeLinecap="round"
          style={{ transform: [{ translateX: translateX2 }] }}
        />
        <AnimatedLine
          x1="25"
          y1="84"
          x2="95"
          y2="84"
          stroke="#B0BEC5"
          strokeWidth="6"
          strokeLinecap="round"
          style={{ transform: [{ translateX: translateX3 }] }}
        />
      </Svg>
    </View>
  );
}

// Slow-spinning sun overlay for small forecast icons (hourly/weekly).
// The hero uses the showcase SunAnimation; everything else renders through
// WeatherIcon with a static SunCore — this makes those suns rotate too.
// One native-driven loop per icon (same cost class as the existing
// RainLayer/SnowLayer loops), slow 30s period so lists stay calm.
function SpinningSun({ cx = 32, cy = 32, s = 1.25, duration = 30000 }) {
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [rotate, duration]);

  const rotateDeg = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // SunCore spans r=18*s (+stroke) around (cx,cy) in 64-units; the overlay
  // box is centered on the sun so rotation stays on axis.
  const half = (19.5 * s) / 64;
  const fx = cx / 64;
  const fy = cy / 64;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: `${(fx - half) * 100}%`,
        top: `${(fy - half) * 100}%`,
        width: `${half * 2 * 100}%`,
        height: `${half * 2 * 100}%`,
        transform: [{ rotate: rotateDeg }],
      }}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`${cx - 19.5 * s} ${cy - 19.5 * s} ${39 * s} ${39 * s}`}
      >
        <SunCore x={cx} y={cy} s={s} />
      </Svg>
    </Animated.View>
  );
}

function WeatherIcon({ type = 'clear', isNight = false, size = 96 }) {
  if (type === 'thunder') {
    return <ThunderWeather size={size} />;
  }
  if (type === 'fog') {
    return <ForecastFogAnimation size={size} />;
  }
  const isRain = type === 'rain' || type === 'showers';
  const isSnow = type === 'snow';
  let content = null;
  let driftingCloud = null;
  let spinningSun = null;
  if (type === 'clear') {
    if (isNight) {
      content = <MoonCrescent transform="translate(8 8) scale(2)" />;
    } else {
      content = null;
      spinningSun = { cx: 32, cy: 32, s: 1.25 };
    }
  } else if (type === 'partly') {
    if (isNight) {
      content = <MoonCrescent transform="translate(20 0) scale(1.5)" />;
    } else {
      content = null;
      spinningSun = { cx: 22, cy: 20, s: 0.85 };
    }
    driftingCloud = { fill: ICON_COLORS.cloudDark, offsetX: 4, offsetY: 8, s: 0.85 };
  } else if (type === 'fog') {
    content = (
      <G>
        <Line x1={14} y1={53} x2={50} y2={53} stroke={ICON_COLORS.fog} strokeWidth={3.5} strokeLinecap="round" />
        <Line x1={20} y1={59} x2={44} y2={59} stroke={ICON_COLORS.fog} strokeWidth={3.5} strokeLinecap="round" />
      </G>
    );
    driftingCloud = { fill: ICON_COLORS.cloudDark, offsetY: -6 };
  } else if (type === 'snow') {
    content = <CloudShape y={-2} fill={ICON_COLORS.cloudDark} />;
  } else if (type === 'fog') {
    content = null;
  } else {
    content = (
      <CloudShape y={-2} fill={type === 'showers' ? ICON_COLORS.cloudDark : ICON_COLORS.cloudLight} />
    );
  }
  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      {isRain && <RainLayer size={size} heavy={type === 'showers'} />}
      {isSnow && <SnowLayer size={size} />}
      <Svg width={size} height={size} viewBox="0 0 64 64">
        {content}
      </Svg>
      {spinningSun && <SpinningSun {...spinningSun} />}
      {driftingCloud && <DriftCloud size={size} {...driftingCloud} />}
    </View>
  );
}

function SunAnimation({ size = 96 }) {
  const rotate = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 20000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.05, duration: 1500, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    );
    spin.start();
    pulse.start();
    return () => {
      spin.stop();
      pulse.stop();
    };
  }, [rotate, scale]);

  const rotateDeg = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ rotate: rotateDeg }, { scale }] }}
    >
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <SunCore x={32} y={32} s={1.25} />
      </Svg>
    </Animated.View>
  );
}

function FogAnimation({ size = 140 }) {
  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;
  const anim3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createLoop = (anim, delay = 0) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 4000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 4000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    };

    const l1 = createLoop(anim1, 0);
    const l2 = createLoop(anim2, 100);
    const l3 = createLoop(anim3, 200);

    l1.start();
    l2.start();
    l3.start();

    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [anim1, anim2, anim3]);

  const translateX1 = anim1.interpolate({ inputRange: [0, 1], outputRange: [0, 22] });
  const translateX2 = anim2.interpolate({ inputRange: [0, 1], outputRange: [0, 26] });
  const translateX3 = anim3.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });

  return (
    <View style={{ width: size, height: size * 0.833, alignItems: 'center', justifyContent: 'center', marginLeft: -24 }}>
      <Svg width={size} height={size * 0.833} viewBox="0 0 120 100">
        <Defs />
        {/* Cloud Body */}
        <Path
          d="M 45 78
             L 95 78
             A 16 16 0 0 0 111 62
             A 15 15 0 0 0 99 48
             A 22 22 0 0 0 58 35
             A 25 25 0 0 0 35 55
             A 16 16 0 0 0 45 78 Z"
          fill="#CFD8DC"
        />

        {/* Wind Line 1 */}
        <AnimatedLine
          x1="35"
          y1="58"
          x2="75"
          y2="58"
          stroke="#B0BEC5"
          strokeWidth="6"
          strokeLinecap="round"
          style={{ transform: [{ translateX: translateX1 }] }}
        />

        {/* Wind Line 2 */}
        <AnimatedLine
          x1="22"
          y1="71"
          x2="80"
          y2="71"
          stroke="#B0BEC5"
          strokeWidth="6"
          strokeLinecap="round"
          style={{ transform: [{ translateX: translateX2 }] }}
        />

        {/* Wind Line 3 */}
        <AnimatedLine
          x1="25"
          y1="84"
          x2="95"
          y2="84"
          stroke="#B0BEC5"
          strokeWidth="6"
          strokeLinecap="round"
          style={{ transform: [{ translateX: translateX3 }] }}
        />
      </Svg>
    </View>
  );
}

const AnimatedLine = Animated.createAnimatedComponent(Line);

export { GithubIcon, WeatherIcon, SunAnimation, FogAnimation };
