Shader "PARADIZE/CaribbeanOcean"
{
    Properties
    {
        _ShallowColor ("Shallow water", Color) = (0.05, 0.70, 0.66, 1)
        _DeepColor ("Deep water", Color) = (0.018, 0.14, 0.23, 1)
        _SkyColor ("Sky reflection", Color) = (0.48, 0.73, 0.87, 1)
        _FoamColor ("Foam", Color) = (0.85, 0.98, 0.96, 1)
        _WindStrength ("Wind wave strength", Range(0,2)) = 0.8
        _WaveTime ("Wave clock", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent-10" "RenderType"="Transparent" "IgnoreProjector"="True" }
        LOD 200
        Pass
        {
            Tags { "LightMode"="ForwardBase" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #pragma multi_compile_fog
            #include "UnityCG.cginc"
            #include "Lighting.cginc"

            UNITY_DECLARE_DEPTH_TEXTURE(_CameraDepthTexture);
            float4 _ShallowColor, _DeepColor, _SkyColor, _FoamColor;
            float _WindStrength, _WaveTime;

            struct appdata { float4 vertex : POSITION; };
            struct v2f
            {
                float4 vertex : SV_POSITION;
                float3 world : TEXCOORD0;
                float4 screenPos : TEXCOORD1;
                float eyeDepth : TEXCOORD2;
                UNITY_FOG_COORDS(3)
            };

            float Wave(float2 p, float2 dir, float wavelength, float amplitude, float speed, inout float2 slope)
            {
                float k = 6.2831853 / wavelength;
                float phase = dot(p, dir) * k - _WaveTime * speed;
                slope += dir * (amplitude * k * cos(phase));
                return amplitude * sin(phase);
            }

            float Displacement(float2 p, out float2 slope)
            {
                slope = float2(0, 0);
                float height = Wave(p, float2(0.93, 0.368), 48, 0.36, 1.133, slope);
                height += Wave(p, float2(0.68, 0.733), 22, 0.18, 1.674, slope);
                height += Wave(p, float2(-0.35, 0.937), 11, 0.07, 2.367, slope);
                slope *= _WindStrength;
                return height * _WindStrength;
            }

            v2f vert(appdata v)
            {
                v2f o;
                float3 world = mul(unity_ObjectToWorld, v.vertex).xyz;
                float2 slope;
                world.y += Displacement(world.xz, slope);
                o.vertex = mul(UNITY_MATRIX_VP, float4(world, 1));
                o.world = world;
                o.screenPos = ComputeScreenPos(o.vertex);
                o.eyeDepth = -mul(UNITY_MATRIX_V, float4(world, 1)).z;
                UNITY_TRANSFER_FOG(o, o.vertex);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float2 slope;
                Displacement(i.world.xz, slope);
                float distanceToView = distance(_WorldSpaceCameraPos.xyz, i.world);
                float rippleFade = 1.0 - smoothstep(90.0, 550.0, distanceToView);
                slope += float2(cos(i.world.x * 1.4 + i.world.z * 0.9 - _WaveTime * 2.3),
                    cos(i.world.z * 1.9 - i.world.x * 0.6 - _WaveTime * 1.7))
                    * 0.045 * _WindStrength * rippleFade;
                float3 normal = normalize(float3(-slope.x, 1.0, -slope.y));
                float3 viewDir = normalize(_WorldSpaceCameraPos.xyz - i.world);
                float rawDepth = SAMPLE_DEPTH_TEXTURE_PROJ(_CameraDepthTexture, UNITY_PROJ_COORD(i.screenPos));
                float sceneDepth = LinearEyeDepth(rawDepth);
                // Convert the ray's eye-depth gap to a vertical shallow-water estimate.
                float rayDepth = max(0.0, sceneDepth - i.eyeDepth);
                float verticalDepth = rayDepth * max(0.08, abs(viewDir.y));
                float deep = 1.0 - exp(-verticalDepth * 0.09);
                float3 color = lerp(_ShallowColor.rgb, _DeepColor.rgb, deep);
                float fresnel = 0.025 + 0.65 * pow(1.0 - saturate(dot(normal, viewDir)), 5.0);
                color = lerp(color, _SkyColor.rgb, fresnel);

                float3 lightDir = normalize(_WorldSpaceLightPos0.xyz + float3(0, 0.0001, 0));
                float3 halfDir = normalize(viewDir + lightDir);
                float specular = pow(saturate(dot(normal, halfDir)), 180.0);
                color += _LightColor0.rgb * specular * 1.4;

                float shoreline = 1.0 - smoothstep(0.15, 2.1, verticalDepth);
                float band = sin(verticalDepth * 6.5 - _WaveTime * 1.8 + sin(i.world.x * 0.21 + i.world.z * 0.19));
                float foam = shoreline * smoothstep(0.0, 0.6, band) * 0.58;
                color = lerp(color, _FoamColor.rgb, foam);
                float opacity = lerp(0.50, 0.995, saturate(verticalDepth * 0.22 + fresnel));
                opacity *= saturate(rayDepth * 1.4);
                fixed4 result = fixed4(color, max(opacity, foam));
                UNITY_APPLY_FOG(i.fogCoord, result);
                return result;
            }
            ENDCG
        }
    }
    Fallback Off
}
