{{/*
Expand the name of the chart.
*/}}
{{- define "llm-logger.name" -}}
{{- .Chart.Name }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "llm-logger.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
