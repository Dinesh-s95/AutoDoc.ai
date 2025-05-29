package com.vm.identityprovider.controller;

import com.vm.identityprovider.entity.Users;
import com.vm.identityprovider.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/idp/users")
public class UserController {

    @Autowired
    private UserService userService;

    @Autowired
    private AuthenticationManager authManager;

    @GetMapping("/")
    public String greet(){
        return "Welcome to proto-calls";
    }
    @PostMapping("/register")
    public Users registerUser(@RequestBody Users user){
        return userService.register(user);
    }

    @PostMapping("/login")
    public String login(@RequestBody Users user){
        System.out.println(user);
        Authentication authentication =
                authManager.authenticate(
                        new UsernamePasswordAuthenticationToken(user.getUsername(), user.getPassword()));

        if (authentication.isAuthenticated()) {
            return "success";
        }
        return "failed";
    }
}
