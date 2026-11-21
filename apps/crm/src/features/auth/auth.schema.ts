import { z } from 'zod'

// zod schemas for the auth forms. Keep MIN_PASSWORD_LENGTH in step with
// auth.minimum_password_length in supabase/config.toml.
export const MIN_PASSWORD_LENGTH = 8

export const EmailSchema = z.email()

export const LoginFormSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
})

export const NewPasswordFormSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH),
    confirm: z.string(),
  })
  .refine((form) => form.password === form.confirm, { path: ['confirm'] })

// The names of the fields that failed, e.g. { email: true }.
export const invalidFields = (error: z.ZodError): Partial<Record<string, true>> =>
  Object.fromEntries(error.issues.map((issue) => [String(issue.path[0]), true]))
