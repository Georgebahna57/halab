# رفع المشروع والعمل من أي مكان

## الخطوة 1 — رفع الكود على GitHub

على **الكمبيوتر** (مرة واحدة)، من **CMD** (مو PowerShell):

```cmd
cd C:\Users\George57\halab
git init
git add .
git commit -m "مشروع حلب — أول رفع"
git branch -M main
git remote add origin https://github.com/Georgebahna57/halab.git
git push -u origin main
```

> **مهم:** ملف `.env` ما يرفع (محمي في `.gitignore`) — هذا صح.

إذا طلب اسم مستخدم وكلمة سر GitHub، استخدم **Personal Access Token** بدل كلمة السر.

---

## الخطوة 2 — نشر على Vercel (رابط ثابت)

1. ادخل [vercel.com](https://vercel.com) وسجّل دخول بحساب GitHub
2. **Add New Project** → اختر مستودع **halab**
3. Framework: **Vite** (يكتشف تلقائياً)
4. **Environment Variables** — أضف:

| الاسم | القيمة |
|---|---|
| `VITE_SUPABASE_URL` | `https://nmgroiunjbvgbiofhtdk.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | مفتاح **anon public** (مو service_role) |

5. اضغط **Deploy**

بعد دقيقة تحصل رابط مثل: `https://halab-xxxxx.vercel.app`

---

## الخطوة 3 — Supabase يسمح بالرابط الجديد

Supabase → **Authentication** → **URL Configuration**:

- **Site URL** = رابط Vercel
- **Redirect URLs** = `https://your-app.vercel.app/**`

---

## التعديل بدون كومبيوتر

| الطريقة | الاستخدام |
|---|---|
| **GitHub.com** | من الجوال/تابلت → المستودع → Edit file → Commit |
| **Vercel** | أي متصفح → الرابط → استخدم التطبيق |
| **Cursor Cloud** | [cursor.com](https://cursor.com) → Cloud Agent → اربط مستودع halab |

---

## تحديث بعد التعديل

إذا عدّلت من GitHub مباشرة، Vercel يعيد النشر تلقائياً.

إذا عدّلت من الكمبيوتر لاحقاً:

```cmd
cd C:\Users\George57\halab
git add .
git commit -m "وصف التعديل"
git push
```

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| `git is not recognized` | نزّل Git من https://git-scm.com |
| `remote origin already exists` | `git remote set-url origin https://github.com/Georgebahna57/halab.git` |
| التطبيق على Vercel فارغ | تأكد من متغيرات البيئة |
| تسجيل الدخول يفشل | حدّث Redirect URLs في Supabase |
