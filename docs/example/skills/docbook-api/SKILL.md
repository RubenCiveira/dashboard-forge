---
name: docbook-api
description: Generates DocBook 5.1 XML reference documentation for REST API endpoints. Covers routes, HTTP methods, request/response schemas and error codes. Use when asked to document an HTTP API or REST service.
---

# DocBook API Documentation Skill

## Goal

Produce a DocBook 5.1 `<book>` document that fully describes the REST API of the target service, suitable for publishing as an API reference manual.

## Workflow

### Step 1 — Discover endpoints
- Search route files with `Grep` (look for patterns like `router.get`, `app.post`, `@Get(`, `Route(`)
- Read each route file to extract: method, path, query params, request body schema, response schema, error codes
- Check shared type/schema files for request/response definitions

### Step 2 — Generate DocBook XML
Create `docs/api-reference.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<book xmlns="http://docbook.org/ns/docbook" version="5.1"
      xmlns:xlink="http://www.w3.org/1999/xlink">
  <title>{Service Name} API Reference</title>
  <info>
    <abstract>
      <para>Base URL: <uri>{base-url}</uri></para>
      <para>All endpoints return <code>{ "data": T }</code> on success
            or <code>{ "error": { "code": string, "message": string } }</code> on failure.</para>
    </abstract>
  </info>

  <!-- One <chapter> per resource group -->
  <chapter xml:id="{resource}">
    <title>{Resource Name}</title>

    <!-- One <section> per endpoint -->
    <section xml:id="{method}-{path-slug}">
      <title>{METHOD} {/path}</title>
      <para>Description of what this endpoint does.</para>

      <section>
        <title>Request</title>
        <variablelist>
          <title>Query Parameters</title>
          <varlistentry>
            <term><parameter>paramName</parameter> (<type>string</type>, optional)</term>
            <listitem><para>Description.</para></listitem>
          </varlistentry>
        </variablelist>
        <para><emphasis role="bold">Body</emphasis> (<mediatype>application/json</mediatype>):</para>
        <programlisting language="json">{request body schema}</programlisting>
      </section>

      <section>
        <title>Response</title>
        <para><emphasis role="bold">200 OK</emphasis></para>
        <programlisting language="json">{response body schema}</programlisting>
      </section>

      <section>
        <title>Error Codes</title>
        <informaltable>
          <tgroup cols="3">
            <thead>
              <row><entry>HTTP</entry><entry>Code</entry><entry>Description</entry></row>
            </thead>
            <tbody>
              <row><entry>404</entry><entry>NOT_FOUND</entry><entry>Resource not found.</entry></row>
            </tbody>
          </tgroup>
        </informaltable>
      </section>

      <section>
        <title>Example</title>
        <programlisting language="bash">curl -X {METHOD} {base-url}{/path} \
  -H "Content-Type: application/json" \
  -d '{example body}'</programlisting>
      </section>
    </section>
  </chapter>
</book>
```

### Step 3 — Validate
- Every discovered endpoint has a `<section>`
- All request and response fields are documented
- curl examples use realistic values

## Output

- File: `docs/api-reference.xml`
- Report: number of endpoints documented, grouped by resource
