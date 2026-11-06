// =====================================================================
//  RUPPEN — arquitetura das cidades dos elefantes (material + peças).
//  Um único material PBR ("arch") para TODA a cidade (tapete instanciado, casinhas das presas,
//  palácio/templos/praça mesclados no SkinnedMesh da cidade): cada vértice diz qual superfície é
//  (aSurf.x: SF.*), e o shader escolhe a textura real (Poly Haven, CC0: white_stucco_02,
//  beige_wall_001, clay_roof_tiles_02, brick_wall_02, marble_01) com coordenadas em METROS da
//  fachada (aFac, ou calculadas da escala da instância), multiplica pela tinta pastel
//  (instanceColor / cor do vértice) e desenha por cima as JANELAS EM ARCO procedurais: vão
//  rebaixado com paralaxe (o "fundo" da janela desliza com o ângulo de visão → profundidade
//  real), moldura e peitoril em relevo (normal), venezianas coloridas, algumas janelas acesas
//  (emissivo quente), lojas/portas no térreo, pilastras e cornijas no palácio; ameias recortadas
//  (discard) no parapeito das casas de laje e balaústres vazados nas balaustradas.
//  De longe o desenho das janelas esmaece para a cor média (sem cintilar).
//  Unidades: metros do modelo-base (o grupo do elefante é ampliado por ELEPHANT.SCALE).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ELEPHANT_CITY as CT, SEED } from '../config.js';
import { tex } from '../assets.js';
import { createRng } from '../util/rng.js';
import { createNoise } from '../util/noise.js';

const TAU = Math.PI * 2;

// tipos de superfície (aSurf.x)
export const SF = { HOUSE: 0, PLAIN: 1, ROOF: 2, FLAT: 3, BRICK: 4, PALACE: 5, PAVE: 6, MARBLE: 7, CANVAS: 8, WOOD: 9, BALUS: 10, CRENEL: 11, DOME: 12, WATER: 13, PRODUCE: 14 };
const WIN_TYPES = new Set([SF.HOUSE, SF.PALACE, SF.BRICK]);

// ------------------------------------------------------------------
//  material
// ------------------------------------------------------------------
const f4 = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const ARCH_PARS_VERT = /* glsl */`
attribute vec2 aFac;
attribute vec3 aSurf;
varying vec2 vFac;
varying vec3 vSurf;
varying vec3 vFacW;
`;
const ARCH_BEGINNORMAL = /* glsl */`
vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif
#ifdef USE_INSTANCING
	vec3 archSc = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
	if ( aSurf.z > 3.5 && aSurf.z < 4.5 ) objectNormal *= archSc;   // cúpula: normal da esfera métrica
#endif
`;
// Instâncias: a geometria é unitária (x,z ∈ ±0.5, paredes y −0.3..1) e escalada por instância; os
// vértices marcados (aSurf.z) são reposicionados em METROS para que telhados, cúpulas, parapeitos e
// toldos tenham proporções reais em qualquer tamanho de casa.
const ARCH_BEGIN = /* glsl */`
vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif
vSurf = aSurf; vFac = aFac; vFacW = vec3( 0.0, 0.0, 0.5 );
#ifdef USE_INSTANCING
{
	float fl = aSurf.z;
	vec3 sc = archSc;
	float rh = ARCH_PITCH * min( sc.x, sc.z );
	if ( fl > 0.5 && fl < 1.5 ) transformed.y = 1.0 - ARCH_PAR / sc.y;                                   // laje dentro do parapeito
	else if ( fl > 1.5 && fl < 2.5 ) {                                                                    // beiral do telhado de 4 águas
		transformed.x = sign( position.x ) * ( 0.5 + ARCH_OVH / sc.x );
		transformed.z = sign( position.z ) * ( 0.5 + ARCH_OVH / sc.z );
		transformed.y = 1.0 - ARCH_OVH * ARCH_PITCH * 2.0 / sc.y;
	} else if ( fl > 2.5 && fl < 3.5 ) {                                                                  // cumeeira
		transformed.x = sign( position.x ) * max( 0.0, 0.5 - 0.5 * sc.z / sc.x );
		transformed.y = 1.0 + rh / sc.y; transformed.z = 0.0;
	} else if ( fl > 3.5 && fl < 4.5 ) {                                                                  // cúpula redonda sobre a laje
		vec3 o = ( position - vec3( 0.0, 0.9, 0.0 ) ) / 0.3;
		float r = 0.3 * min( sc.x, sc.z );
		transformed = vec3( 0.0, 1.0 - ARCH_PAR / sc.y, 0.0 ) + o * r / sc;
	} else if ( fl > 4.5 && fl < 5.5 ) { transformed.y = ARCH_AWN / sc.y; transformed.z = 0.5 + 0.03 / sc.z; }          // toldo: borda presa
	else if ( fl > 5.5 && fl < 6.5 ) { transformed.y = ( ARCH_AWN - 0.32 ) / sc.y; transformed.z = 0.5 + 0.85 / sc.z; } // toldo: borda solta
	vec3 pS = transformed * sc;
	vec3 an = abs( normal );
	float sl = max( 0.25, length( normal.xz ) );
	if ( an.y > 0.8 ) vFac = pS.xz;
	else if ( an.x > an.z ) vFac = vec2( - pS.z * sign( normal.x ), pS.y / sl );
	else vFac = vec2( pS.x * sign( normal.z ), pS.y / sl );
	vec3 hq = fract( instanceMatrix[ 3 ].xyz * 0.1031 ); hq += dot( hq, hq.yzx + 33.33 );
	vFacW = vec3( an.x > an.z ? sc.z : sc.x, sc.y, fract( ( hq.x + hq.y ) * hq.z ) );
}
#endif
`;
const ARCH_PARS_FRAG = /* glsl */`
uniform sampler2D tStuD, tStuN, tBeiD, tBeiN, tRoofD, tRoofN, tBrkD, tBrkN, tMarD, tMarN;
uniform float uArchReady;
varying vec2 vFac;
varying vec3 vSurf;
varying vec3 vFacW;
float aH1( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
// vão em arco (negativo dentro): retângulo |x|<hw, y>y0, com meia-circunferência de centro (0, ys)
float archD( vec2 p, float hw, float y0, float ys ) { return max( length( vec2( p.x, max( p.y - ys, 0.0 ) ) ) - hw, y0 - p.y ); }
// relevo da célula da janela: vão −1, moldura +0.6, peitoril +0.9
float archRelief( vec2 p, vec4 sh, float fr, float e ) {
	float d = archD( p, sh.x, sh.y, sh.z );
	float h = - smoothstep( e, - e, d ) + 0.6 * smoothstep( - e, e, d ) * smoothstep( fr + e, fr - e, d );
	if ( sh.y > 0.01 && abs( p.x ) < sh.x + fr * 1.8 && p.y < sh.y && p.y > sh.y - fr * 1.6 ) h = max( h, 0.9 );
	return h;
}
float aLum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
// amostra relativa à luminância média linear da textura (média ≈ 1; a cor vem da tinta)
vec3 archTex( sampler2D t, vec2 f, vec2 dx, vec2 dy, float s, vec3 mean ) {
	if ( uArchReady < 0.5 ) return vec3( 1.0 );
	return textureGrad( t, f * s, dx * s, dy * s ).rgb / mean;
}
vec2 archNrm( sampler2D t, vec2 f, vec2 dx, vec2 dy, float s ) {
	if ( uArchReady < 0.5 ) return vec2( 0.0 );
	return textureGrad( t, f * s, dx * s, dy * s ).xy * 2.0 - 1.0;
}
`;
const ARCH_MAP = /* glsl */`
vec2 archNXY = vec2( 0.0 ); float archRough = 0.88; vec3 archEmit = vec3( 0.0 );
vec3 archNg = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
vec3 archTn = vec3( 1.0, 0.0, 0.0 ), archBn = vec3( 0.0, 1.0, 0.0 );
{
	int ty = int( vSurf.x + 0.5 );
	vec2 f = vFac, fdx = dFdx( f ), fdy = dFdy( f );
	float fw = max( length( fdx ), length( fdy ) ) + 1e-5;        // metros por pixel
	// quadro tangente pelas derivadas de tela (coordenadas da fachada)
	vec3 q0 = dFdx( - vViewPosition ), q1 = dFdy( - vViewPosition );
	vec3 q1p = cross( q1, archNg ), q0p = cross( archNg, q0 );
	vec3 tT = q1p * fdx.x + q0p * fdy.x, tB = q1p * fdx.y + q0p * fdy.y;
	archTn = tT * inversesqrt( max( dot( tT, tT ), 1e-24 ) ); archBn = tB * inversesqrt( max( dot( tB, tB ), 1e-24 ) );
	vec3 Vv = normalize( vViewPosition );
	vec3 Vt = vec3( dot( Vv, archTn ), dot( Vv, archBn ), max( dot( Vv, archNg ), 0.06 ) );
	vec3 tint = vec3( 1.0 );
	#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
		tint = vColor.rgb;
	#endif
	float rnd = vFacW.z;
	float u = f.x, v = f.y, W = vFacW.x, H = vFacW.y;
	bool inst = false;
	#ifdef USE_INSTANCING
		inst = true;
		// ameias: o topo do parapeito das casas de laje é recortado (só de perto: de longe fica liso)
		if ( ty == 0 && mod( floor( vSurf.y + 0.5 ), 2.0 ) > 0.5 && H - v < ARCH_PAR * 0.48 && fw < 0.1 && fract( ( u + W * 0.5 ) / ( ARCH_PAR * 1.3 ) ) > 0.5 ) discard;
	#endif
	if ( ty == 11 && vSurf.y - v < 0.45 * vSurf.y && fw < vSurf.z * 0.3 && fract( u / vSurf.z ) > 0.5 ) discard;
	vec3 col = tint;
	bool wallLike = ty == 0 || ty == 1 || ty == 11 || ty == 12;
	if ( wallLike || ty == 3 ) {
		vec3 stu = archTex( tStuD, f, fdx, fdy, 1.0 / ARCH_T_STU, vec3( 0.419 ) );
		float big = aLum( archTex( tStuD, f + 17.0, fdx, fdy, 0.08 / ARCH_T_STU, vec3( 0.419 ) ) );
		vec3 det = mix( vec3( 1.0 ), stu, 0.85 );
		vec2 nn = archNrm( tStuN, f, fdx, fdy, 1.0 / ARCH_T_STU ) * 0.75;
		if ( fract( rnd * 7.31 ) > 0.55 ) {                     // reboco bege (beige_wall_001) em parte das casas
			vec3 bei = archTex( tBeiD, f, fdx, fdy, 1.0 / ARCH_T_BEI, vec3( 0.274 ) );
			float bl = aLum( bei );
			det = vec3( mix( 1.0, bl, 0.85 ) ) * mix( vec3( 1.0 ), bei / max( bl, 0.05 ), 0.2 );
			nn = archNrm( tBeiN, f, fdx, fdy, 1.0 / ARCH_T_BEI ) * 0.85;
		}
		col = tint * det * mix( 1.0, big, 0.3 );
		archNXY = nn; archRough = 0.9;
		if ( ty == 3 ) { col *= vec3( 0.85, 0.83, 0.8 ); archRough = 0.93; }
	} else if ( ty == 2 ) {                                     // telhas de barro (clay_roof_tiles_02)
		vec3 rt = archTex( tRoofD, f, fdx, fdy, 1.0 / ARCH_T_ROOF, vec3( 0.13 ) );
		vec3 rc = tint;
		if ( inst ) {
			float pr = fract( rnd * 3.17 );
			if ( vSurf.y > 0.5 ) rc = pr < 0.5 ? vec3( 0.50, 0.12, 0.07 ) : ( pr < 0.8 ? vec3( 0.58, 0.18, 0.10 ) : vec3( 0.66, 0.30, 0.20 ) );
			else rc = pr < 0.3 ? vec3( 0.72, 0.36, 0.30 ) : ( pr < 0.55 ? vec3( 0.62, 0.25, 0.14 ) : ( pr < 0.8 ? vec3( 0.80, 0.47, 0.40 ) : vec3( 0.70, 0.43, 0.35 ) ) );
		}
		float rl = aLum( rt );
		col = rc * mix( 1.0, clamp( rl, 0.2, 2.2 ), 0.9 );
		archNXY = archNrm( tRoofN, f, fdx, fdy, 1.0 / ARCH_T_ROOF ) * 1.1; archRough = 0.74;
	} else if ( ty == 4 ) {                                     // tijolo vermelho (brick_wall_02, tingido)
		vec3 bt = archTex( tBrkD, f, fdx, fdy, 1.0 / ARCH_T_BRK, vec3( 0.316 ) );
		float bl = aLum( bt );
		col = tint * vec3( 0.46, 0.15, 0.10 ) * mix( 1.0, clamp( bl, 0.2, 2.0 ), 0.9 );
		archNXY = archNrm( tBrkN, f, fdx, fdy, 1.0 / ARCH_T_BRK ); archRough = 0.9;
	} else if ( ty == 5 || ty == 7 || ty == 10 ) {              // palácio / mármore / balaustrada
		vec3 mt = archTex( tMarD, f, fdx, fdy, 1.0 / ARCH_T_MAR, vec3( 0.35 ) );
		float ml = aLum( mt );
		if ( ty == 5 ) {
			vec3 stu = archTex( tStuD, f, fdx, fdy, 1.0 / ARCH_T_STU, vec3( 0.419 ) );
			col = tint * vec3( 0.84, 0.82, 0.78 ) * mix( vec3( 1.0 ), stu, 0.55 ) * mix( 1.0, ml, 0.3 );
			archNXY = archNrm( tStuN, f, fdx, fdy, 1.0 / ARCH_T_STU ) * 0.5; archRough = 0.72;
		} else {
			col = tint * vec3( 0.86, 0.84, 0.8 ) * mix( 1.0, ml, 0.5 ) * mix( vec3( 1.0 ), mt / max( ml, 0.05 ) * vec3( 0.8, 1.04, 1.6 ), 0.12 );
			archNXY = archNrm( tMarN, f, fdx, fdy, 1.0 / ARCH_T_MAR ) * 0.4; archRough = 0.45;
		}
		if ( ty == 10 ) {                                       // balaústres vazados entre corrimão e base
			float rel = v / max( vSurf.y, 0.01 );
			if ( rel > 0.2 && rel < 0.8 ) {
				if ( fw < vSurf.z * 0.3 ) { float q = abs( fract( u / vSurf.z ) - 0.5 ); if ( q > 0.11 + 0.09 * sin( 3.1416 * ( rel - 0.2 ) / 0.6 ) ) discard; }
				else col *= 0.7;
			}
		}
	} else if ( ty == 6 ) {                                     // calçamento de lajes
		vec2 pc = f / ARCH_PAVE; float rr = floor( pc.y ); pc.x += 0.5 * mod( rr, 2.0 );
		vec2 ci = floor( pc ), cf = fract( pc );
		vec3 bei = archTex( tBeiD, f, fdx, fdy, 1.0 / ARCH_T_BEI, vec3( 0.274 ) );
		col = tint * vec3( 0.72, 0.66, 0.56 ) * ( 0.84 + 0.28 * aH1( ci + 3.7 ) ) * mix( 1.0, aLum( bei ), 0.6 );
		float jd = min( min( cf.x, 1.0 - cf.x ) * ARCH_PAVE.x, min( cf.y, 1.0 - cf.y ) * ARCH_PAVE.y );
		col *= mix( 1.0, mix( 0.55, 1.0, smoothstep( 0.03, 0.03 + max( fw, 0.02 ), jd ) ), 1.0 - smoothstep( 0.12, 0.45, fw ) );
		archNXY = archNrm( tBeiN, f, fdx, fdy, 1.0 / ARCH_T_BEI ) * 0.6; archRough = 0.82;
	} else if ( ty == 8 ) {                                     // lona dos toldos e tendas
		vec3 cc = tint;
		float pr = fract( rnd * 5.71 );
		if ( vSurf.y > 0.5 ) cc = pr < 0.25 ? vec3( 0.55, 0.08, 0.06 ) : ( pr < 0.5 ? vec3( 0.12, 0.32, 0.14 ) : ( pr < 0.75 ? vec3( 0.10, 0.22, 0.45 ) : vec3( 0.75, 0.48, 0.12 ) ) );
		float stp = mix( step( 0.5, fract( u / 0.55 ) ), 0.5, smoothstep( 0.1, 0.3, fw ) );
		if ( fract( rnd * 9.13 ) > 0.5 ) cc = mix( cc, vec3( 0.82, 0.8, 0.74 ), stp );
		col = cc; archNXY = archNrm( tStuN, f, fdx, fdy, 2.0 / ARCH_T_STU ) * 0.25; archRough = 0.95;
	} else if ( ty == 9 ) {                                     // madeira
		col = vec3( 0.26, 0.16, 0.09 ) * ( 0.8 + 0.35 * aH1( floor( f * vec2( 1.0, 9.0 ) ) ) ); archRough = 0.85;
	} else if ( ty == 13 ) {                                    // água do chafariz
		col = vec3( 0.03, 0.08, 0.09 ); archRough = 0.06;
		archNXY = 0.08 * vec2( sin( f.x * 3.1 + f.y * 1.3 ), sin( f.y * 2.7 - f.x * 0.9 ) );
	} else if ( ty == 14 ) {                                    // frutas e cestos nas bancas
		vec2 pc = f / 0.32; vec2 ci = floor( pc ); float hp = aH1( ci + 1.3 + rnd * 17.0 );
		vec3 pcol = hp < 0.2 ? vec3( 0.8, 0.32, 0.04 ) : ( hp < 0.4 ? vec3( 0.55, 0.05, 0.04 ) : ( hp < 0.6 ? vec3( 0.2, 0.38, 0.06 ) : ( hp < 0.8 ? vec3( 0.85, 0.62, 0.1 ) : vec3( 0.5, 0.3, 0.15 ) ) ) );
		float dm = smoothstep( 0.42, 0.3, length( fract( pc ) - 0.5 ) );
		col = mix( vec3( 0.3, 0.2, 0.1 ), pcol, mix( dm, 0.6, smoothstep( 0.08, 0.25, fw ) ) ); archRough = 0.7;
	}
	// ---------------- janelas em arco (casas, palácio, arcadas de tijolo) ----------------
	if ( ty == 0 || ty == 4 || ty == 5 ) {
		float bay = ARCH_BAY, st = ARCH_ST, uo = u;
		bool ok = true;
		if ( inst ) {
			float nb = max( 1.0, floor( W / ARCH_BAY + 0.35 ) ); bay = W / nb; uo = u + W * 0.5;
			float topRes = mod( floor( vSurf.y + 0.5 ), 2.0 ) > 0.5 ? ARCH_PAR + 0.06 : 0.12;
			ok = v >= 0.0 && ( floor( v / st ) + 1.0 ) * st <= H - topRes + 0.18 * st;
		} else {
			if ( vSurf.y > 0.0 ) bay = vSurf.y;
			if ( vSurf.z > 0.0 ) st = vSurf.z;
		}
		// esmaecimento anisotrópico: vãos e andares somem separadamente quando ficam menores que ~2 px
		float fwU = length( vec2( fdx.x, fdy.x ) ), fwV = length( vec2( fdx.y, fdy.y ) );
		float kV = 1.0 - smoothstep( 0.2 * st, 0.5 * st, fwV ), kWin = ( 1.0 - smoothstep( 0.2 * bay, 0.5 * bay, fwU ) ) * kV;
		if ( ok ) {
			float row = floor( v / st ), cell = floor( uo / bay );
			vec2 p = vec2( ( fract( uo / bay ) - 0.5 ) * bay, v - row * st );
			float h1 = aH1( vec2( cell, row ) + rnd * 91.7 ), h2 = aH1( vec2( row * 3.1 + 7.0, cell * 1.7 ) + rnd * 37.3 );
			vec4 sh = vec4( 0.205 * bay, 0.3 * st, 0.62 * st, 0.17 * st );     // meia-largura, peitoril, nascença do arco, profundidade
			float fr = 0.045 * bay;
			vec3 frameC = min( col * 1.12, vec3( 0.95 ) );
			bool shopRow = false;
			if ( ty == 5 ) { sh = vec4( 0.27 * bay, 0.2 * st, 0.56 * st, 0.32 * st ); fr = 0.05 * bay; }
			else if ( ty == 4 ) { sh = vec4( 0.33 * bay, 0.1 * st, 0.52 * st, 0.28 * st ); fr = 0.075 * bay; frameC = vec3( 0.78, 0.69, 0.54 ); }
			else if ( inst && row < 0.5 ) {
				bool shops = mod( floor( vSurf.y + 0.5 ), 4.0 ) > 1.5;
				if ( shops || h1 < 0.25 ) { sh = vec4( 0.36 * bay, 0.0, 0.5 * st, 0.3 * st ); shopRow = true; }
				else if ( h1 < 0.45 ) sh = vec4( 0.2 * bay, 0.0, 0.56 * st, 0.2 * st );
			}
			float cov = ( 2.0 * sh.x * max( sh.z - sh.y, 0.0 ) + 1.5708 * sh.x * sh.x ) / ( bay * st );
			vec3 colFar = col * ( 1.0 - 0.85 * cov );
			// média ao longo da fileira (de longe as janelas de um andar viram uma faixa escura)
			float hwY = p.y < sh.y ? 0.0 : ( p.y < sh.z ? sh.x : sqrt( max( 0.0, sh.x * sh.x - ( p.y - sh.z ) * ( p.y - sh.z ) ) ) );
			colFar = mix( colFar, col * ( 1.0 - 0.85 * min( 1.0, 2.0 * hwY / bay ) ), kV );
			if ( kWin > 0.0 ) {
				float eps = max( fw * 0.7, 0.003 * bay );
				float d = archD( p, sh.x, sh.y, sh.z );
				float inside = smoothstep( eps, - eps, d );
				float frameM = smoothstep( - eps, eps, d ) * smoothstep( fr + eps, fr - eps, d );
				float sill = ( sh.y > 0.01 && abs( p.x ) < sh.x + fr * 1.8 && p.y < sh.y && p.y > sh.y - fr * 1.6 ) ? 1.0 : 0.0;
				// venezianas (parte das casas), algumas fechadas
				bool shut = ty == 0 && ! shopRow && fract( rnd * 13.7 ) < ARCH_SHUT;
				float ps = fract( rnd * 4.37 );
				vec3 shutC = ps < 0.3 ? vec3( 0.12, 0.26, 0.14 ) : ( ps < 0.55 ? vec3( 0.10, 0.20, 0.36 ) : ( ps < 0.8 ? vec3( 0.08, 0.26, 0.26 ) : vec3( 0.28, 0.15, 0.07 ) ) );
				float slat = 0.78 + 0.22 * step( 0.5, fract( p.y / ( 0.045 * st ) ) );
				float shM = 0.0;
				if ( shut ) { float ax = abs( p.x ) - sh.x - fr; shM = step( 0.0, ax ) * step( ax, sh.x * 0.9 ) * step( sh.y, p.y ) * step( p.y, sh.z + sh.x * 0.5 ); }
				bool closed = shut && h2 < 0.2;
				// paralaxe: o fundo do vão desliza com a direção de visão → vê-se o rebordo de reboco
				vec2 pb = p - Vt.xy / Vt.z * sh.w;
				float back = smoothstep( eps, - eps, archD( pb, sh.x * 0.94, sh.y, sh.z ) );
				bool lit = h2 > 1.0 - ARCH_LIT && ! closed && ty != 4;
				vec3 glass = vec3( 0.026, 0.028, 0.032 ) + vec3( 0.05, 0.054, 0.06 ) * smoothstep( sh.y, sh.z + sh.x, pb.y );
				if ( shopRow ) glass = mix( vec3( 0.05, 0.035, 0.025 ), vec3( 0.5, 0.3, 0.12 ) * ( 0.4 + 0.6 * h2 ), step( pb.y, 0.22 * st ) * 0.7 );
				if ( lit ) glass = vec3( 0.9, 0.6, 0.3 ) * 0.3;
				vec3 openC = mix( col * 0.42, glass, back );
				if ( closed ) openC = shutC * slat;
				vec3 cw = mix( col, frameC, max( frameM, sill ) );
				if ( shut ) cw = mix( cw, shutC * slat, shM );
				cw = mix( cw, openC, inside );
				if ( ty == 5 ) {                                // pilastras e cornija de cada andar
					float pe = abs( abs( p.x ) - 0.41 * bay );
					cw *= 1.0 - 0.16 * smoothstep( eps * 1.5 + 0.01 * bay, 0.0, pe );
					cw *= p.y > st * 0.93 ? 1.06 : ( p.y > st * 0.88 ? 0.8 : 1.0 );
				} else if ( ty == 0 ) cw *= 1.0 - 0.1 * smoothstep( 0.03 * st + eps, 0.03 * st - eps, abs( p.y - 0.02 * st ) );
				float rW = mix( archRough, closed ? 0.8 : mix( 0.85, 0.16, back ), inside );
				float e = max( eps, 0.004 * bay );
				float r0 = archRelief( p, sh, fr, e ), rx = archRelief( p + vec2( e, 0.0 ), sh, fr, e ), ry = archRelief( p + vec2( 0.0, e ), sh, fr, e );
				vec2 g = vec2( rx - r0, ry - r0 ) / e * ( 0.03 * bay );
				col = mix( colFar, cw, kWin );
				archNXY = mix( archNXY, archNXY * ( 1.0 - inside ) - g, kWin );
				archRough = mix( archRough, rW, kWin );
				if ( lit ) archEmit = vec3( 1.0, 0.6, 0.28 ) * 0.35 * inside * back * kWin;
			} else col = colFar;
		}
	}
	// AO de contato: a base das casas (ruas estreitas) escurece
	if ( inst && wallLike && ty != 12 ) col *= mix( 0.5, 1.0, smoothstep( - 0.25, 1.4, v ) );
	diffuseColor.rgb = col;
}
`;
const ARCH_NORMAL = /* glsl */`
#ifdef USE_INSTANCING
	if ( int( vSurf.x + 0.5 ) != 12 ) normal = archNg;     // caixas: normal facetada exata
#endif
normal = normalize( mat3( archTn, archBn, normal ) * normalize( vec3( archNXY, 1.0 ) ) );
`;

let archMat = null;
export function getArchMaterial() {
  if (archMat) return archMat;
  const ids = {
    tStuD: ['white_stucco_02', 'diff'], tStuN: ['white_stucco_02', 'nor_gl'], tBeiD: ['beige_wall_001', 'diff'], tBeiN: ['beige_wall_001', 'nor_gl'],
    tRoofD: ['clay_roof_tiles_02', 'diff'], tRoofN: ['clay_roof_tiles_02', 'nor_gl'], tBrkD: ['brick_wall_02', 'diff'], tBrkN: ['brick_wall_02', 'nor_gl'],
    tMarD: ['marble_01', 'diff'], tMarN: ['marble_01', 'nor_gl'],
  };
  const uni = { uArchReady: { value: 0 } };
  for (const [k, [id, m]] of Object.entries(ids)) uni[k] = { value: tex(id, m) };
  const T = CT.TILE;
  const defs = {
    ARCH_ST: f4(CT.STOREY), ARCH_BAY: f4(CT.BAY), ARCH_PAR: f4(CT.PARAPET), ARCH_OVH: f4(CT.EAVE), ARCH_PITCH: f4(CT.ROOF_PITCH), ARCH_AWN: f4(CT.AWNING_Y),
    ARCH_T_STU: f4(T.stucco), ARCH_T_BEI: f4(T.beige), ARCH_T_ROOF: f4(T.roof), ARCH_T_BRK: f4(T.brick), ARCH_T_MAR: f4(T.marble),
    ARCH_PAVE: `vec2(${f4(T.pave[0])}, ${f4(T.pave[1])})`, ARCH_SHUT: f4(CT.SHUTTERS), ARCH_LIT: f4(CT.LIT_WINDOWS),
  };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, envMapIntensity: CT.ENV });
  m.userData.arch = uni;
  m.userData.ready = () => Object.keys(ids).every((k) => uni[k].value && uni[k].value.image && uni[k].value.image.width);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.defines = { ...(sh.defines || {}), ...defs };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ARCH_PARS_VERT)
      .replace('#include <beginnormal_vertex>', ARCH_BEGINNORMAL)
      .replace('#include <begin_vertex>', ARCH_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ARCH_PARS_FRAG)
      .replace('#include <map_fragment>', ARCH_MAP)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = archRough;')
      .replace('#include <normal_fragment_maps>', ARCH_NORMAL)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += archEmit;');
  };
  m.customProgramCacheKey = () => 'ruppen-arch-1';
  archMat = m;
  return m;
}

// ------------------------------------------------------------------
//  geometrias mescladas (palácio, templos, praça, orelhas, presas…)
// ------------------------------------------------------------------
// Garante os atributos da cidade (aFac, aSurf, color, uv) numa geometria.
export function cityAttrs(g, surf = null, color = null) {
  const n = g.attributes.position.count;
  if (!g.attributes.aFac) g.setAttribute('aFac', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.aSurf || surf) {
    const a = new Float32Array(n * 3); const s = surf || [SF.PLAIN, 0, 0];
    for (let i = 0; i < n; i++) { a[i * 3] = s[0]; a[i * 3 + 1] = s[1] || 0; a[i * 3 + 2] = s[2] || 0; }
    g.setAttribute('aSurf', new THREE.BufferAttribute(a, 3));
  }
  if (!g.attributes.color || color !== null) {
    const c = new THREE.Color(color === null ? 0xffffff : color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
// Coordenadas da fachada a partir da normal (topo: x,z; paredes/telhados: horizontal, distância na rampa).
export function autoFac(g) {
  const p = g.attributes.position, nr = g.attributes.normal, n = p.count, a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const nx = nr.getX(i), ny = nr.getY(i), nz = nr.getZ(i), sl = Math.max(0.25, Math.hypot(nx, nz));
    if (Math.abs(ny) > 0.8) { a[i * 2] = p.getX(i); a[i * 2 + 1] = p.getZ(i); }
    else if (Math.abs(nx) > Math.abs(nz)) { a[i * 2] = -p.getZ(i) * Math.sign(nx); a[i * 2 + 1] = p.getY(i) / sl; }
    else { a[i * 2] = p.getX(i) * Math.sign(nz); a[i * 2 + 1] = p.getY(i) / sl; }
  }
  g.setAttribute('aFac', new THREE.BufferAttribute(a, 2));
  return g;
}
const s3 = (s) => [s[0], s[1] || 0, s[2] || 0];
// Caixa com fachadas em metros: side = [tipo, vão, andar] (vão arredondado para caber inteiro na face),
// sideZ (faces ±z), top, bottom (false = sem a face de baixo), noTop, vOff (desloca a contagem de andares).
export function facBox(w, h, d, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const side = s3(o.side || [SF.PLAIN]), sideZ = s3(o.sideZ || side), top = s3(o.top || [SF.FLAT]), bot = s3(o.bottom || [SF.PLAIN]);
  const faceS = [side, side, top, bot, sideZ, sideZ];
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = g.attributes.uv, n = uv.count, fac = new Float32Array(n * 2), surf = new Float32Array(n * 3);
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = dims[f], s = faceS[f]; let su = fw;
    if (s[1] > 0 && WIN_TYPES.has(s[0])) su = Math.max(1, Math.round(fw / s[1])) * s[1];
    const side_ = f !== 2 && f !== 3;
    for (let i = f * 4; i < f * 4 + 4; i++) {
      fac[i * 2] = uv.getX(i) * su; fac[i * 2 + 1] = uv.getY(i) * fh + (side_ ? (o.vOff || 0) : 0);
      surf[i * 3] = s[0]; surf[i * 3 + 1] = s[1]; surf[i * 3 + 2] = s[2];
    }
  }
  g.setAttribute('aFac', new THREE.BufferAttribute(fac, 2)); g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
  const drop = []; if (o.bottom === false) drop.push(3); if (o.noTop) drop.push(2);
  if (drop.length) { const idx = Array.from(g.index.array).filter((_, k) => !drop.includes(Math.floor(k / 6))); g.setIndex(idx); }
  g.clearGroups();
  return cityAttrs(g, null, o.color ?? 0xffffff);
}
// Cilindro/cone com fachada em metros (u = arco, v = geratriz); tampas em x,z.
export function facCyl(rT, rB, h, segs, o = {}) {
  const g = new THREE.CylinderGeometry(rT, rB, h, segs, 1, !!o.open);
  const side = s3(o.side || [SF.PLAIN]), cap = s3(o.cap || [SF.FLAT]);
  const circ = TAU * Math.max(rT, rB), slant = Math.hypot(h, rB - rT);
  let su = circ; if (side[1] > 0 && WIN_TYPES.has(side[0])) su = Math.max(1, Math.round(circ / side[1])) * side[1];
  const p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv, n = p.count;
  const fac = new Float32Array(n * 2), surf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const isCap = Math.abs(nr.getY(i)) > 0.999, s = isCap ? cap : side;
    if (isCap) { fac[i * 2] = p.getX(i); fac[i * 2 + 1] = p.getZ(i); } else { fac[i * 2] = uv.getX(i) * su; fac[i * 2 + 1] = uv.getY(i) * slant; }
    surf[i * 3] = s[0]; surf[i * 3 + 1] = s[1]; surf[i * 3 + 2] = s[2];
  }
  g.setAttribute('aFac', new THREE.BufferAttribute(fac, 2)); g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 3));
  g.clearGroups();
  return cityAttrs(g, null, o.color ?? 0xffffff);
}
// Cúpula branca (meia esfera, reboco liso)
export function whiteDome(r, ws = 16, hs = 7, color = 0xf4f0e8, type = SF.DOME) {
  const g = new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, Math.PI / 2);
  const uv = g.attributes.uv, n = uv.count, fac = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { fac[i * 2] = uv.getX(i) * TAU * r; fac[i * 2 + 1] = uv.getY(i) * Math.PI * r; }
  g.setAttribute('aFac', new THREE.BufferAttribute(fac, 2));
  return cityAttrs(g, [type, 0, 0], color);
}
// Construtor de triângulos facetados (normal por face) → BufferGeometry indexada.
class GeoB {
  constructor() { this.P = []; this.N = []; this.S = []; }
  tri(a, b, c, s, fl = [0, 0, 0], nrm = null) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / L);
    [a, b, c].forEach((v, k) => { this.P.push(...v); this.N.push(...(nrm ? nrm[k] : n)); this.S.push(s[0], s[1] || 0, fl[k]); });
  }
  quad(a, b, c, d, s, fl = [0, 0, 0, 0]) { this.tri(a, b, c, s, [fl[0], fl[1], fl[2]]); this.tri(a, c, d, s, [fl[0], fl[2], fl[3]]); }
  build(indexed = true) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.S, 3));
    cityAttrs(g);
    if (indexed) g = mergeVertices(g);
    return g;
  }
}
// Telhado de 4 águas em metros (base no y=0, cumeeira ao longo de x), com beiral.
export function hipRoof(w, d, rh, ovh = 0, color = 0xc46a4a) {
  const b = new GeoB(), s = [SF.ROOF, 0];
  if (d > w) { const g = hipRoof(d, w, rh, ovh, color); g.rotateY(Math.PI / 2); return autoFac(g); }
  const hx = w / 2 + ovh, hz = d / 2 + ovh, y0 = -ovh * (rh / (d / 2)), r = Math.max(0, w / 2 - d / 2);
  const E = (x, z) => [x * hx, y0, z * hz], R = (x) => [x * r, rh, 0];
  b.quad(E(-1, 1), E(1, 1), R(1), R(-1), s); b.quad(E(1, -1), E(-1, -1), R(-1), R(1), s);
  b.tri(E(1, 1), E(1, -1), R(1), s); b.tri(E(-1, -1), E(-1, 1), R(-1), s);
  const g = b.build(false); autoFac(g); cityAttrs(g, null, color);
  return mergeVertices(g);
}
// Anel de parapeito (ameias por discard) ou balaustrada ao redor de um retângulo w×d (espessura t).
export function rimRing(w, d, h, t, type, pitch, color = 0xf2eee6) {
  const parts = [];
  for (const [bw, bd, x, z] of [[w, t, 0, d / 2 - t / 2], [w, t, 0, -d / 2 + t / 2], [t, d - 2 * t, w / 2 - t / 2, 0], [t, d - 2 * t, -w / 2 + t / 2, 0]]) {
    const g = facBox(bw, h, bd, { side: [type, h, pitch], top: [SF.MARBLE], bottom: false, noTop: type === SF.CRENEL, color });
    g.translate(x, h / 2, z); parts.push(g);
  }
  return mergeGeometries(parts, false);
}
// Casa mesclada (orelhas, alto da cabeça, terraços): caixa com janelas + laje ou telhado de 4 águas.
export function mHouse(w, h, d, { wall = 0xf4efe5, roof = 0xc46a4a, kind = 'hip', bay = CT.BAY, st = CT.STOREY, sink = 0, top = null } = {}) {
  const body = facBox(w, h + sink, d, { side: [SF.HOUSE, bay, st], top: top || (kind === 'hip' ? [SF.PLAIN] : [SF.FLAT]), bottom: false, vOff: -sink, color: wall });
  body.translate(0, (h - sink) / 2, 0);
  if (kind !== 'hip') return body;
  const r = hipRoof(w, d, CT.ROOF_PITCH * Math.min(w, d), Math.min(CT.EAVE, 0.06 * Math.min(w, d)), roof); r.translate(0, h, 0);
  return mergeGeometries([body, r], false);
}
// Cúpula dourada em bulbo (torno) com leve barriga e ponta; geometria simples (o material é o ouro).
export function goldDome(R, H, segs = 24, pts = 10) {
  const prof = [];
  for (let i = 0; i <= pts; i++) { const t = i / pts; prof.push(new THREE.Vector2(Math.max(0.001, R * Math.pow(1 - t, 0.62) * (1 + 0.1 * Math.sin(Math.PI * t))), H * t)); }
  return new THREE.LatheGeometry(prof, segs);
}

// ------------------------------------------------------------------
//  arquétipos instanciados (geometria unitária; ver ARCH_BEGIN)
// ------------------------------------------------------------------
// paredes: x,z ∈ ±0.5, y de −0.3 (afundado na pele) a 1
function walls(b, s) {
  const y0 = -0.3, y1 = 1;
  b.quad([-0.5, y0, 0.5], [0.5, y0, 0.5], [0.5, y1, 0.5], [-0.5, y1, 0.5], s);
  b.quad([0.5, y0, -0.5], [-0.5, y0, -0.5], [-0.5, y1, -0.5], [0.5, y1, -0.5], s);
  b.quad([0.5, y0, 0.5], [0.5, y0, -0.5], [0.5, y1, -0.5], [0.5, y1, 0.5], s);
  b.quad([-0.5, y0, -0.5], [-0.5, y0, 0.5], [-0.5, y1, 0.5], [-0.5, y1, -0.5], s);
}
const flatRoof = (b) => b.quad([-0.5, 0.9, 0.5], [0.5, 0.9, 0.5], [0.5, 0.9, -0.5], [-0.5, 0.9, -0.5], [SF.FLAT, 0], [1, 1, 1, 1]);
function hipTop(b, palette) {
  const s = [SF.ROOF, palette], E = (x, z) => [x * 0.5, 1, z * 0.5], R = (x) => [x * 0.25, 1.35, 0];
  b.quad(E(-1, 1), E(1, 1), R(1), R(-1), s, [2, 2, 3, 3]); b.quad(E(1, -1), E(-1, -1), R(-1), R(1), s, [2, 2, 3, 3]);
  b.tri(E(1, 1), E(1, -1), R(1), s, [2, 2, 3]); b.tri(E(-1, -1), E(-1, 1), R(-1), s, [2, 2, 3]);
}
let archetypeCache = null;
export function getArchetypes() {
  if (archetypeCache) return archetypeCache;
  const out = {};
  // A: casa de laje com parapeito ameado (10 tri)
  { const b = new GeoB(); walls(b, [SF.HOUSE, 1]); flatRoof(b); out.flat = b.build(); }
  // B: casa com telhado de 4 águas de telha (14 tri); B': telhas vermelhas (presas)
  { const b = new GeoB(); walls(b, [SF.HOUSE, 0]); hipTop(b, 0); out.hip = b.build(); }
  { const b = new GeoB(); walls(b, [SF.HOUSE, 0]); hipTop(b, 1); out.hipRed = b.build(); }
  // C: bloco alto (4–6 andares) com ameias, lojas no térreo e toldo de lona (12 tri)
  { const b = new GeoB(); walls(b, [SF.HOUSE, 3]); flatRoof(b); b.quad([-0.4, 0.25, 0.5], [-0.4, 0.2, 0.75], [0.4, 0.2, 0.75], [0.4, 0.25, 0.5], [SF.CANVAS, 1], [5, 6, 6, 5]); out.tall = b.build(); }
  // D: casa com cupulazinha branca (10 + 24 tri)
  {
    const b = new GeoB(); walls(b, [SF.HOUSE, 1]); flatRoof(b);
    const sp = new THREE.SphereGeometry(0.3, 8, 2, 0, TAU, 0, Math.PI / 2).toNonIndexed(); sp.translate(0, 0.9, 0);
    const P = sp.attributes.position, N = sp.attributes.normal;
    for (let i = 0; i < P.count; i += 3) {
      const v = [0, 1, 2].map((k) => [P.getX(i + k), P.getY(i + k), P.getZ(i + k)]), n = [0, 1, 2].map((k) => [N.getX(i + k), N.getY(i + k), N.getZ(i + k)]);
      const area = Math.hypot(...[0, 1, 2].map((c) => v[1][c] - v[0][c])) * Math.hypot(...[0, 1, 2].map((c) => v[2][c] - v[0][c]));
      if (area < 1e-9) continue;
      b.tri(v[0], v[1], v[2], [SF.DOME, 0], [4, 4, 4], n);
    }
    out.dome = b.build();
  }
  // banca de mercado: balcão de madeira com frutas, toldo de duas águas (cor da instância), 4 postes
  {
    const b = new GeoB(), W = [SF.WOOD, 0], X = 0.5, Z = 0.3, Y = 0.32;
    b.quad([-X, 0, Z], [X, 0, Z], [X, Y, Z], [-X, Y, Z], W); b.quad([X, 0, -Z], [-X, 0, -Z], [-X, Y, -Z], [X, Y, -Z], W);
    b.quad([X, 0, Z], [X, 0, -Z], [X, Y, -Z], [X, Y, Z], W); b.quad([-X, 0, -Z], [-X, 0, Z], [-X, Y, Z], [-X, Y, -Z], W);
    b.quad([-X, Y, Z], [X, Y, Z], [X, Y, -Z], [-X, Y, -Z], [SF.PRODUCE, 0]);
    const C = [SF.CANVAS, 0];
    b.quad([-0.56, 0.8, 0.48], [0.56, 0.8, 0.48], [0.56, 1, 0], [-0.56, 1, 0], C); b.quad([0.56, 0.8, -0.48], [-0.56, 0.8, -0.48], [-0.56, 1, 0], [0.56, 1, 0], C);
    for (const [x, z] of [[-0.48, 0.4], [0.48, 0.4], [-0.48, -0.4], [0.48, -0.4]]) b.quad([x - 0.018, 0, z], [x + 0.018, 0, z], [x + 0.018, 0.82, z], [x - 0.018, 0.82, z], W);
    out.stall = b.build();
  }
  // guarda-sol redondo (cone de lona listrada + haste)
  {
    const b = new GeoB(), C = [SF.CANVAS, 0], n = 8;
    for (let i = 0; i < n; i++) { const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU; b.tri([Math.cos(a1) * 0.55, 0.8, Math.sin(a1) * 0.55], [Math.cos(a0) * 0.55, 0.8, Math.sin(a0) * 0.55], [0, 1, 0], C); }
    b.quad([-0.015, 0, 0], [0.015, 0, 0], [0.015, 0.95, 0], [-0.015, 0.95, 0], [SF.WOOD, 0]);
    b.quad([0, 0, -0.015], [0, 0, 0.015], [0, 0.95, 0.015], [0, 0.95, -0.015], [SF.WOOD, 0]);
    out.umbrella = b.build();
  }
  archetypeCache = out;
  return out;
}
// Tris por instância de cada arquétipo (orçamento)
export function archetypeTris(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }

// ------------------------------------------------------------------
//  textura da CROSTA (casca sempre visível): de longe, a mesma cidade vista do alto — quarteirões de
//  casinhas pálidas com telhados rosa/terracota e lajes claras, ruas estreitas escuras, sombra das
//  casas para um lado. Tileável (grade periódica).
// ------------------------------------------------------------------
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function makeCrustTextures() {
  const S = 1024, N = 13, cell = S / N;
  const c = cv(S, S), ctx = c.getContext('2d'), b = cv(S, S), bctx = b.getContext('2d');
  ctx.fillStyle = '#7d7368'; ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#303030'; bctx.fillRect(0, 0, S, S);
  const rng = createRng(SEED + 818);
  const pale = ['#f4eee4', '#efe5d6', '#f1dfd2', '#ecd8c6', '#f6f1ea', '#e8d6c2', '#f2e3dc', '#e9dccb'];
  const roofs = ['#c98272', '#b9644c', '#d39a8a', '#c47458', '#d8a898', '#b5705c'];
  const wrapRect = (g, x, y, w, h) => { for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) g.fillRect(x + ox, y + oy, w, h); };
  const wrapPoly = (g, pts) => { for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy))); g.closePath(); g.fill(); } };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const stX = i % 4 === 0, stY = j % 3 === 0;                  // ruas: a cada 4 colunas / 3 fileiras
    const g0 = cell * 0.05, gx = stX ? cell * 0.22 : g0, gy = stY ? cell * 0.22 : g0;
    const x = i * cell + gx, y = j * cell + gy, w = cell - gx - g0 - rng() * cell * 0.08, h = cell - gy - g0 - rng() * cell * 0.08;
    const hgt = 0.4 + rng() * 0.6, sh = cell * 0.1 * hgt;
    ctx.fillStyle = 'rgba(40,30,28,0.45)'; wrapRect(ctx, x + sh, y + sh, w, h);   // sombra
    const r = rng();
    if (r < 0.5) {   // telhado de 4 águas: duas águas claras/escuras + cumeeira
      const col = roofs[Math.floor(rng() * roofs.length)];
      ctx.fillStyle = col; wrapRect(ctx, x, y, w, h);
      const ins = Math.min(w, h) * 0.5;
      ctx.fillStyle = 'rgba(255,240,230,0.22)'; wrapPoly(ctx, [[x, y], [x + w, y], [x + w - ins, y + h / 2], [x + ins, y + h / 2]]);
      ctx.fillStyle = 'rgba(60,20,10,0.22)'; wrapPoly(ctx, [[x, y + h], [x + w, y + h], [x + w - ins, y + h / 2], [x + ins, y + h / 2]]);
    } else {         // laje clara com parapeito
      ctx.fillStyle = pale[Math.floor(rng() * pale.length)]; wrapRect(ctx, x, y, w, h);
      ctx.fillStyle = 'rgba(90,70,60,0.18)'; wrapRect(ctx, x + w * 0.12, y + h * 0.12, w * 0.76, h * 0.76);
      if (r > 0.93) { ctx.fillStyle = '#f7f3ec'; for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) { ctx.beginPath(); ctx.arc(x + w / 2 + ox, y + h / 2 + oy, Math.min(w, h) * 0.28, 0, TAU); ctx.fill(); } }
    }
    const lum = 120 + hgt * 130; bctx.fillStyle = `rgb(${lum},${lum},${lum})`; wrapRect(bctx, x, y, w, h);
  }
  // grão
  const n = createNoise(SEED + 819), gc = cv(256, 256), gctx = gc.getContext('2d'), img = gctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const v = 200 + 55 * (n.noise2(x * 0.11, y * 0.11) * 0.5 + 0.5), k = (y * 256 + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
  gctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.35; for (let y = 0; y < S; y += 256) for (let x = 0; x < S; x += 256) ctx.drawImage(gc, x, y);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(b); bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}
// Crosta: de perto (onde o tapete de casas está à vista) a casca vira o CHÃO das ruas (pedra), de longe a
// textura de casinhas.
export function patchCrustMaterial(m) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{
  float kf = smoothstep( ${f4(CT.CRUST_FADE[0])}, ${f4(CT.CRUST_FADE[1])}, length( vViewPosition ) );
  vec3 pave = vec3( 0.36, 0.32, 0.28 ) * ( 0.8 + 0.4 * dot( diffuseColor.rgb, vec3( 0.3333 ) ) );
  diffuseColor.rgb = mix( pave, diffuseColor.rgb, kf );
}`);
  };
  m.customProgramCacheKey = () => 'ruppen-crust-1';
  return m;
}
