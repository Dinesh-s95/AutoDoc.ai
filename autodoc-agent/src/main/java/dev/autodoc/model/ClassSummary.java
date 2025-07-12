package dev.autodoc.model;

import java.util.*;

public class ClassSummary {
    public String className;
    public List<String> annotations = new ArrayList<>();
    public List<String> methods = new ArrayList<>();
    public List<String> endpoints = new ArrayList<>();
    public List<String> fields = new ArrayList<>();
    public boolean isEntity = false;
    public boolean isRestController = false;
}
