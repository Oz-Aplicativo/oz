#!/bin/bash
# ============================================================
#  OZ App — Deploy das Edge Functions (novo fluxo de pagamento)
#  Execute este script no terminal após instalar o Supabase CLI
# ============================================================
#
#  Pré-requisitos:
#    npm install -g supabase
#    supabase login
#    supabase link --project-ref qyxefytxyrmvotjnhoir
#
#  Configurar secrets obrigatórios:
#    supabase secrets set MP_ACCESS_TOKEN=APP_USR-...seu-token...
#    supabase secrets set MP_WEBHOOK_SECRET=seu-segredo-webhook
# ============================================================

set -e

PROJECT_REF="qyxefytxyrmvotjnhoir"

echo "🚀 Fazendo deploy das Edge Functions do OZ App..."
echo "   Projeto: $PROJECT_REF"
echo ""

# Funções do novo fluxo de pagamento (deploy obrigatório para ativações pagas)
echo "📦 [1/3] criar-transacao  — cria ativação pending_payment + PIX..."
supabase functions deploy criar-transacao --project-ref $PROJECT_REF

echo "📦 [2/3] webhook-pagamento — ativa benefício após pagamento aprovado..."
supabase functions deploy webhook-pagamento --project-ref $PROJECT_REF

echo "📦 [3/3] get-activation-status — polling de status pelo frontend..."
supabase functions deploy get-activation-status --project-ref $PROJECT_REF

echo ""
echo "✅ Deploy do fluxo de pagamento concluído!"
echo ""
echo "⚠️  Lembre-se de configurar o webhook no Mercado Pago:"
echo "   URL: https://${PROJECT_REF}.supabase.co/functions/v1/webhook-pagamento"
echo "   Evento: payment"
echo ""
echo "📋 Execute também o SQL em edge-functions/sql/activations-pending-payment.sql"
echo "   no Supabase Dashboard > SQL Editor"
