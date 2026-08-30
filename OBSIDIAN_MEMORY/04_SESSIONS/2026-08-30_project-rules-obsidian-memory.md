# 2026-08-30 Aturan Project dan Vault Obsidian

## Metadata
- Tanggal: 2026-08-30
- Task: buat aturan mutlak, konfigurasi opencode, vault memori Obsidian
- Mode: build
- Status: selesai

## Tujuan
- Membuat aturan project profesional untuk CEPUapps.
- Membuat folder memori Obsidian agar opencode memahami konteks project.
- Mengelompokkan aturan responsive ke vault Obsidian.

## Konteks dibaca
- `appsscript.json`
- `RESPONSIVE_RULES.md`
- `.obsidian/app.json`
- `.obsidian/workspace.json`
- Dokumentasi opencode config/rules/plugins.

## File diubah
- `opencode.json`
- `AGENTS.md`
- `RESPONSIVE_RULES.md`
- `.opencode/agents/memory-keeper.md`
- `.opencode/commands/snap-session.md`
- `.opencode/commands/review-memory.md`
- `.opencode/plugins/memory.ts`
- `OBSIDIAN_MEMORY/00_INDEX.md`
- `OBSIDIAN_MEMORY/01_RULES/PROJECT_GUIDELINES.md`
- `OBSIDIAN_MEMORY/01_RULES/RESPONSIVE_RULES.md`
- `OBSIDIAN_MEMORY/02_ARCHITECTURE/PROJECT_MAP.md`
- `OBSIDIAN_MEMORY/07_TEMPLATES/SESSION_TEMPLATE.md`
- `OBSIDIAN_MEMORY/07_TEMPLATES/BUG_TEMPLATE.md`
- `OBSIDIAN_MEMORY/07_TEMPLATES/DECISION_TEMPLATE.md`
- `OBSIDIAN_MEMORY/07_TEMPLATES/DEPLOYMENT_TEMPLATE.md`

## Keputusan
- `AGENTS.md` menjadi aturan mutlak utama opencode.
- `OBSIDIAN_MEMORY/` menjadi vault memori project.
- `RESPONSIVE_RULES.md` root hanya menjadi pointer ke `OBSIDIAN_MEMORY/01_RULES/RESPONSIVE_RULES.md`.
- Deploy/commit/push/clasp push wajib persetujuan eksplisit user.
- Plugin memori dibuat aman/no-op; pencatatan lengkap dijalankan lewat aturan dan command `snap-session` agar tidak riskan merusak startup opencode.

## Bug / akar masalah / fix
- Aturan responsive lama memerintahkan commit/push/clasp push otomatis. Fix: dipindah ke model persetujuan eksplisit.

## Validasi
- File utama dibaca ulang setelah dibuat.
- Konfigurasi JSON perlu validasi runtime opencode setelah restart.

## Risiko
- Plugin hook otomatis penuh bergantung API event opencode yang bisa berubah; karena itu dibuat no-op.
- Memori otomatis lengkap tetap bergantung kepatuhan agent menjalankan aturan/command.

## Next step
- Restart opencode agar `opencode.json`, agent, command, dan plugin baru terbaca.
- Gunakan `/snap-session` pada akhir sesi penting.
