---
name: docbook-module
description: Generates DocBook 5.1 XML reference documentation for a source code module. Covers exported functions, classes, types and their parameters. Use when asked to document a module, library or package.
---

# DocBook Module Documentation Skill

## Goal

Produce a DocBook 5.1 `<reference>` document that fully describes the public API of the target module.

## Workflow

### Step 1 — Analyze
- Read the target source file(s) with `Read` and `Grep`
- Identify all exported symbols: functions, classes, interfaces, types, constants
- Note parameters (name, type, required/optional, default), return types, thrown errors

### Step 2 — Generate DocBook XML
Create a file `docs/{module-name}-reference.xml` with the following structure:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<reference xmlns="http://docbook.org/ns/docbook" version="5.1"
           xmlns:xlink="http://www.w3.org/1999/xlink">
  <title>{Module Name} Reference</title>
  <info>
    <abstract><para>Brief description of the module.</para></abstract>
  </info>

  <!-- One <refentry> per exported symbol -->
  <refentry xml:id="{symbol-id}">
    <refnamediv>
      <refname>{symbolName}</refname>
      <refpurpose>One-line description.</refpurpose>
    </refnamediv>
    <refsynopsisdiv>
      <synopsis>{function signature or class declaration}</synopsis>
    </refsynopsisdiv>
    <refsection>
      <title>Description</title>
      <para>Detailed explanation.</para>
    </refsection>
    <refsection>
      <title>Parameters</title>
      <variablelist>
        <varlistentry>
          <term><parameter>paramName</parameter> (<type>TypeName</type>)</term>
          <listitem><para>Description. Required/Optional. Default: value.</para></listitem>
        </varlistentry>
      </variablelist>
    </refsection>
    <refsection>
      <title>Returns</title>
      <para><type>ReturnType</type> — description.</para>
    </refsection>
    <refsection>
      <title>Throws</title>
      <variablelist>
        <varlistentry>
          <term><errorname>ErrorType</errorname></term>
          <listitem><para>When this error is thrown.</para></listitem>
        </varlistentry>
      </variablelist>
    </refsection>
    <refsection>
      <title>Example</title>
      <programlisting language="{lang}">{code example}</programlisting>
    </refsection>
  </refentry>
</reference>
```

### Step 3 — Validate structure
- Every exported symbol has a `<refentry>`
- All parameters are documented
- Examples are syntactically correct

## Output

- File: `docs/{module-name}-reference.xml`
- Report the number of symbols documented
