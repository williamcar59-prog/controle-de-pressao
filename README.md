# Controle de Pressão 🩺

Aplicativo (PWA) para **registrar e monitorar pressão arterial** com 3 aferições por dia
(**manhã, tarde e noite**), gerando **médias diárias, semanais e um relatório para o médico**.

Funciona **offline**, os dados ficam salvos no próprio aparelho.

---

## Como usar

### 1. Rodar no computador

```bash
node servidor.js
```

Abra **http://localhost:8080** no navegador (Chrome, Edge ou Firefox).

### 2. Instalar como aplicativo

No Chrome/Edge, clique no botão **“Instalar app”** (ou menu ⋮ → *Instalar aplicativo*).
Vai ganhar ícone próprio e abrir em janela própria.

> A instalação (PWA) só funciona em **HTTPS ou localhost**.
> Para usar **no celular**, publique a pasta em um serviço HTTPS gratuito
> (GitHub Pages, Netlify, Cloudflare Pages) e abra o endereço no navegador do celular →
> menu → *Adicionar à tela inicial*.

### 3. Acessar do celular pela mesma rede Wi-Fi

Com o servidor rodando, ele mostra um endereço tipo `http://192.168.x.x:8080`.
Abra no celular (mesma rede). O app funciona normalmente, mas a *instalação* exigirá HTTPS.

---

## O que o app faz

| Recurso | Detalhe |
|---|---|
| **Registrar** | Data, hora, sistólica, diastólica, pulso, período (manhã/tarde/noite — automático pelo horário) e observação. Classificação aparece na hora. |
| **Média do dia** | Chips com a média de cada período e a média geral do dia. |
| **Histórico** | Lista por dia, com média diária, indicação de dia completo (3x) ou incompleto, edição e exclusão. Filtros por período e turno. |
| **Relatório (para o médico)** | Médias gerais, **média por período** (manhã/tarde/noite), **médias semanais com variação**, gráfico de evolução diária, gráfico semanal, distribuição por classificação, dias completos. |
| **Exportar** | **CSV** (abre no Excel), **PDF/Imprimir** (via impressão do relatório), **Backup JSON** e restauração. |
| **Lembretes** | Aviso às horas definidas para manhã, tarde e noite (enquanto o app estiver aberto). |

### Classificação (orientativa — critérios ACC/AHA)

| Valor | Classificação |
|---|---|
| < 120 e < 80 | Ótima |
| 120–129 e < 80 | Normal |
| 130–139 ou 80–89 | Normal alta |
| 140–159 ou 90–99 | Hipertensão estágio 1 |
| ≥ 160 ou ≥ 100 | Hipertensão estágio 2 |
| ≥ 180 ou ≥ 120 | Crise hipertensiva |

> Uso apenas para acompanhamento. **O diagnóstico é do médico.**
> Pressão muito alta com sintomas → procure atendimento.

---

## Arquivos

```
index.html            estrutura do app
styles.css            visual
app.js                toda a lógica (registro, médias, gráficos, exportação, lembretes)
manifest.webmanifest  manifesto do PWA (instalação)
sw.js                 service worker (funciona offline)
servidor.js           servidor local (node servidor.js)
gerar-icones.js       gera os ícones PNG (node gerar-icones.js)
icons/                ícones 192px, 512px e maskable
```

## Onde ficam os dados

Em `localStorage` do navegador, nas chaves `cp_records_v1` e `cp_settings_v1`.
**Faça backup periódico** (botão *Backup* no Histórico) — limpar os dados do navegador apaga o histórico.

## Tecnologia

HTML/CSS/JavaScript puros, **zero dependências**, sem internet necessária após a primeira carga.
Gráficos em SVG feitos à mão — nada de CDN.
