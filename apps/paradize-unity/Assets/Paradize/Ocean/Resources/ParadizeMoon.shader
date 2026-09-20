Shader "PARADIZE/LunarDisc"
{
    Properties
    {
        _Phase ("Approximate synodic phase", Range(0,1)) = 0.5
    }
    SubShader
    {
        Tags { "Queue"="Transparent-20" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            float _Phase;
            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct v2f { float4 vertex : SV_POSITION; float2 uv : TEXCOORD0; };
            v2f vert(appdata v)
            {
                v2f o;
                o.vertex = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }
            fixed4 frag(v2f i) : SV_Target
            {
                float2 p = i.uv * 2.0 - 1.0;
                float radius2 = dot(p,p);
                clip(1.0 - radius2);
                float3 normal = float3(p, sqrt(max(0.0, 1.0 - radius2)));
                float angle = _Phase * 6.2831853;
                float3 sunlight = float3(sin(angle), 0, -cos(angle));
                float lit = saturate(dot(normal, sunlight) * 1.5);
                float albedoVariation = 0.92 + 0.04 * sin(p.x * 29.0 + sin(p.y * 17.0)) * sin(p.y * 23.0);
                float3 color = float3(0.93, 0.95, 0.90) * albedoVariation;
                return fixed4(color, lit * (1.0 - smoothstep(0.97, 1.0, radius2)) * 0.86);
            }
            ENDCG
        }
    }
    Fallback Off
}
